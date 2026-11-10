/**
 * Payments: online checkout via a hosted provider page, signed webhooks, front-desk collection, refunds.
 *
 * Rules enforced here:
 *  - The amount charged is always computed from the booking in the DB, never from the client.
 *  - A booking is confirmed ONLY when a signature-verified webhook says it was paid — never on browser redirect.
 *  - Each webhook event id is processed once (payment_events unique key) → idempotent retries.
 *  - Card numbers / CVVs never touch this server (hosted checkout).
 */
const prisma = require('../config/prisma');
const env = require('../config/env');
const AppError = require('../utils/AppError');
const { serialize } = require('../utils/serialize');
const { toCents, fromCents, pesoCents } = require('../utils/money');
const { randomCode } = require('../utils/crypto');
const { getPagination, paged } = require('../utils/pagination');
const { parseDate, addDays } = require('../utils/dates');
const availability = require('./availability.service');
const bookingService = require('./booking.service');
const hotel = require('./hotel.service');
const email = require('./email.service');
const notifications = require('./notification.service');
const audit = require('./audit.service');

const providers = { mock: require('./payments/mock.provider'), paymongo: require('./payments/paymongo.provider') };
const providerByName = { MOCK: providers.mock, PAYMONGO: providers.paymongo };

function currentProvider() {
  const p = providers[env.payments.provider];
  if (!p) throw new AppError(503, `Unknown PAYMENT_PROVIDER "${env.payments.provider}".`);
  return p;
}

const newPaymentRef = () => `PAY-${randomCode(10)}`;

// ───────────────────────────── Online checkout ─────────────────────────────

async function createCheckout(req, bookingId) {
  const booking = await bookingService.getRaw(bookingId);
  bookingService.assertCanView(req.user, booking);
  if (booking.paymentMethod !== 'ONLINE') throw AppError.badRequest('This reservation is set to Pay at Hotel.');
  if (booking.bookingStatus !== 'PENDING_PAYMENT') throw AppError.conflict(booking.bookingStatus === 'EXPIRED' ? 'This reservation hold has expired. Please make a new booking.' : 'This reservation does not require online payment.');
  if (!booking.expiresAt || booking.expiresAt <= new Date()) throw AppError.conflict('This reservation hold has expired. Please make a new booking.');
  const amountCents = toCents(booking.totalAmount) - toCents(booking.amountPaid);
  if (amountCents <= 0) throw AppError.conflict('Nothing left to pay for this booking.');

  const provider = currentProvider();
  const existing = booking.payments.find((p) => p.paymentStatus === 'PENDING' && p.provider === provider.name && p.checkoutUrl && toCents(p.amount) === amountCents);
  if (existing) return { payment_id: existing.id, checkout_url: existing.checkoutUrl, expires_at: booking.expiresAt };

  const payment = await prisma.payment.create({ data: { bookingId, paymentReference: newPaymentRef(), provider: provider.name, amount: fromCents(amountCents), paymentStatus: 'PENDING' } });
  try {
    const { sessionId, checkoutUrl } = await provider.createCheckout({
      payment,
      booking,
      successUrl: `${env.appUrl}/payment-result.html?booking=${bookingId}&status=success`,
      cancelUrl: `${env.appUrl}/payment-result.html?booking=${bookingId}&status=cancelled`,
    });
    await prisma.payment.update({ where: { id: payment.id }, data: { providerSessionId: sessionId, checkoutUrl } });
    await audit.log(req, 'CHECKOUT_CREATED', { entityType: 'payment', entityId: payment.id, description: `${booking.bookingReference} ₱${payment.amount} via ${provider.name}` });
    return { payment_id: payment.id, checkout_url: checkoutUrl, expires_at: booking.expiresAt };
  } catch (err) {
    await prisma.payment.update({ where: { id: payment.id }, data: { paymentStatus: 'FAILED', failureReason: String(err.message).slice(0, 250) } });
    throw err;
  }
}

// ───────────────────────────── Webhooks ─────────────────────────────

async function handleWebhook(rawBody, headers, provider = currentProvider()) {
  provider.verifyWebhook(rawBody, headers); // throws 400 on bad signature
  let body;
  try { body = JSON.parse(rawBody); } catch { throw AppError.badRequest('Invalid JSON payload.'); }
  const evt = provider.parseEvent(body);
  if (!evt.eventId) throw AppError.badRequest('Event id missing.');

  const seen = await prisma.paymentEvent.findUnique({ where: { provider_eventId: { provider: provider.name, eventId: evt.eventId } } });
  if (seen) return { received: true, duplicate: true };

  let outcome = { received: true };
  if (evt.kind === 'PAID') outcome = await processPaid(provider, evt, rawBody);
  else if (evt.kind === 'FAILED') outcome = await processFailed(provider, evt, rawBody);
  else if (evt.kind === 'REFUND_UPDATE') outcome = await processRefundUpdate(provider, evt, rawBody);
  else await recordEvent(prisma, provider, evt, rawBody);
  return outcome;
}

const recordEvent = (client, provider, evt, raw) => client.paymentEvent.create({ data: { provider: provider.name, eventId: evt.eventId, eventType: evt.eventType || evt.kind, payload: raw.slice(0, 1_000_000) } });

async function findPaymentForEvent(client, provider, evt) {
  if (evt.sessionId) {
    const p = await client.payment.findUnique({ where: { providerSessionId: evt.sessionId } });
    if (p) return p;
  }
  if (evt.paymentReference) return client.payment.findUnique({ where: { paymentReference: evt.paymentReference } });
  return null;
}

async function processPaid(provider, evt, raw) {
  const post = { emails: [], adminAlert: null };
  const result = await bookingService.withRetry(() => prisma.$transaction(async (tx) => {
    const payment = await findPaymentForEvent(tx, provider, evt);
    if (!payment) { await recordEvent(tx, provider, evt, raw); return { received: true, ignored: 'unknown payment' }; }
    await tx.$queryRaw`SELECT id FROM bookings WHERE id = ${payment.bookingId} FOR UPDATE`;
    const fresh = await tx.payment.findUnique({ where: { id: payment.id } });
    if (fresh.paymentStatus === 'PAID') { await recordEvent(tx, provider, evt, raw); return { received: true, already: true }; }
    if (evt.amount !== undefined && toCents(evt.amount) !== toCents(fresh.amount)) {
      await tx.payment.update({ where: { id: fresh.id }, data: { notes: `Amount mismatch: provider reported ${evt.amount}` } });
      await recordEvent(tx, provider, evt, raw);
      post.adminAlert = `Payment ${fresh.paymentReference} reported amount ${evt.amount} but expected ${fresh.amount}. Review manually.`;
      return { received: true, mismatch: true };
    }

    const now = new Date();
    await tx.payment.update({ where: { id: fresh.id }, data: { paymentStatus: 'PAID', paidAt: now, providerPaymentId: evt.providerPaymentId || null, paymentMethod: evt.method || null } });
    const booking = await tx.booking.findUnique({ where: { id: fresh.bookingId }, include: { rooms: true } });
    const paid = fromCents(toCents(booking.amountPaid) + toCents(fresh.amount));
    const data = { amountPaid: paid, paymentStatus: bookingService.derivePaymentStatus(booking.totalAmount, paid, booking.amountRefunded) };

    const holdValid = booking.bookingStatus === 'PENDING_PAYMENT' && booking.expiresAt > now;
    const lapsed = booking.bookingStatus === 'EXPIRED' || (booking.bookingStatus === 'PENDING_PAYMENT' && booking.expiresAt <= now);
    if (holdValid) {
      Object.assign(data, { bookingStatus: 'CONFIRMED', confirmedAt: now, expiresAt: null });
    } else if (lapsed) {
      // Payment arrived after the hold lapsed: confirm only if every assigned room is still free.
      await availability.lockRoomTypes(tx, booking.rooms.map((r) => r.roomTypeId));
      let ok = true;
      for (const r of booking.rooms) {
        if (!(await availability.isRoomFree(tx, { roomId: r.roomId, checkIn: booking.checkIn, checkOut: booking.checkOut, excludeBookingId: booking.id, now }))) { ok = false; break; }
      }
      if (ok) {
        Object.assign(data, { bookingStatus: 'CONFIRMED', confirmedAt: now, expiresAt: null });
        if (booking.bookingStatus === 'EXPIRED' && booking.couponId) await tx.coupon.update({ where: { id: booking.couponId }, data: { usedCount: { increment: 1 } } });
      } else {
        if (booking.bookingStatus === 'PENDING_PAYMENT') data.bookingStatus = 'EXPIRED';
        post.adminAlert = `Payment ${fresh.paymentReference} for ${booking.bookingReference} arrived after its hold expired and the rooms were re-booked. Refund required.`;
      }
    } else if (booking.bookingStatus === 'CANCELLED') {
      post.adminAlert = `Payment ${fresh.paymentReference} received for cancelled booking ${booking.bookingReference}. Refund required.`;
    }
    await tx.booking.update({ where: { id: booking.id }, data });
    await recordEvent(tx, provider, evt, raw);
    post.bookingId = booking.id;
    post.paymentId = fresh.id;
    post.confirmed = data.bookingStatus === 'CONFIRMED';
    return { received: true, booking_id: booking.id, confirmed: post.confirmed };
  }, bookingService.TX_OPTS));

  if (post.bookingId) {
    const booking = await bookingService.getRaw(post.bookingId);
    const payment = booking.payments.find((p) => p.id === post.paymentId);
    const settings = await hotel.getSettings();
    await notifications.notify(booking.userId, { title: 'Payment received', message: `We received ₱${payment.amount} for ${booking.bookingReference}.`, type: 'PAYMENT', bookingId: booking.id });
    await email.send('paymentConfirmed', booking.guestEmail, { booking, payment }, booking.guestFirstName);
    if (post.confirmed) await bookingService.afterStatusChange(booking, settings);
    await audit.log(null, 'PAYMENT_CONFIRMED', { entityType: 'payment', entityId: payment.id, description: `${booking.bookingReference} ₱${payment.amount} (${payment.paymentMethod || 'online'}) via webhook` });
  }
  if (post.adminAlert) {
    await notifications.notifyAdmins({ title: 'Payment needs attention', message: post.adminAlert, type: 'PAYMENT', bookingId: post.bookingId || null });
    await audit.log(null, 'PAYMENT_ALERT', { entityType: 'payment', description: post.adminAlert });
  }
  return result;
}

async function processFailed(provider, evt, raw) {
  const payment = await findPaymentForEvent(prisma, provider, evt);
  await prisma.$transaction(async (tx) => {
    if (payment) {
      await tx.payment.updateMany({ where: { id: payment.id, paymentStatus: 'PENDING' }, data: { paymentStatus: 'FAILED', failureReason: String(evt.reason || 'Payment failed').slice(0, 250) } });
      await tx.booking.updateMany({ where: { id: payment.bookingId, paymentStatus: 'PENDING', amountPaid: 0 }, data: { paymentStatus: 'FAILED' } });
    }
    await recordEvent(tx, provider, evt, raw);
  });
  if (payment) {
    const booking = await bookingService.getRaw(payment.bookingId);
    await notifications.notify(booking.userId, { title: 'Payment not completed', message: `Payment for ${booking.bookingReference} did not go through. You can retry before your hold expires.`, type: 'PAYMENT', bookingId: booking.id });
    if (booking.bookingStatus === 'PENDING_PAYMENT') await email.send('paymentFailed', booking.guestEmail, { booking }, booking.guestFirstName);
  }
  return { received: true };
}

async function processRefundUpdate(provider, evt, raw) {
  const refund = evt.providerRefundId ? await prisma.refund.findFirst({ where: { providerReference: evt.providerRefundId } }) : null;
  const status = evt.refundStatus === 'succeeded' ? 'SUCCEEDED' : evt.refundStatus === 'failed' ? 'FAILED' : null;
  await prisma.$transaction(async (tx) => {
    if (refund && status && refund.refundStatus === 'PENDING') await settleRefund(tx, refund.id, status);
    await recordEvent(tx, provider, evt, raw);
  });
  if (refund && status) await notifyRefund(refund.id);
  return { received: true };
}

// ───────────────────────────── Front desk ─────────────────────────────

async function recordFrontDeskPayment(req, { booking_id, amount, payment_method, notes }) {
  const payment = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM bookings WHERE id = ${booking_id} FOR UPDATE`;
    const booking = await tx.booking.findUnique({ where: { id: booking_id } });
    if (!booking) throw AppError.notFound('Booking not found.');
    if (!['PENDING_CONFIRMATION', 'CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT'].includes(booking.bookingStatus)) throw AppError.conflict(`Payments cannot be recorded for a ${booking.bookingStatus.toLowerCase().replace('_', ' ')} booking.`);
    const balance = toCents(booking.totalAmount) - toCents(booking.amountPaid);
    if (balance <= 0) throw AppError.conflict('This booking is already fully paid.');
    if (toCents(amount) > balance) throw AppError.badRequest(`Amount exceeds the balance due of ${pesoCents(balance)}.`, { fields: { amount: `Max ${pesoCents(balance)}` } });
    const p = await tx.payment.create({
      data: { bookingId: booking_id, paymentReference: newPaymentRef(), provider: 'FRONT_DESK', amount: fromCents(toCents(amount)), paymentMethod: payment_method, paymentStatus: 'PAID', paidAt: new Date(), recordedById: req.user.id, notes: notes || null },
    });
    const paid = fromCents(toCents(booking.amountPaid) + toCents(amount));
    await tx.booking.update({ where: { id: booking_id }, data: { amountPaid: paid, paymentStatus: bookingService.derivePaymentStatus(booking.totalAmount, paid, booking.amountRefunded) } });
    return p;
  }, bookingService.TX_OPTS);
  const booking = await bookingService.getRaw(booking_id);
  await audit.log(req, 'PAYMENT_RECORDED', { entityType: 'payment', entityId: payment.id, description: `${booking.bookingReference} ₱${payment.amount} ${payment_method}` });
  await notifications.notify(booking.userId, { title: 'Payment received', message: `₱${payment.amount} was received at the front desk for ${booking.bookingReference}.`, type: 'PAYMENT', bookingId: booking.id });
  await email.send('paymentConfirmed', booking.guestEmail, { booking, payment }, booking.guestFirstName);
  return serialize(payment);
}

// ───────────────────────────── Refunds ─────────────────────────────

async function settleRefund(tx, refundId, status) {
  const refund = await tx.refund.update({ where: { id: refundId }, data: { refundStatus: status } });
  if (status !== 'SUCCEEDED') return refund;
  const payment = await tx.payment.findUnique({ where: { id: refund.paymentId } });
  const pRef = toCents(payment.amountRefunded) + toCents(refund.amount);
  await tx.payment.update({ where: { id: payment.id }, data: { amountRefunded: fromCents(pRef), paymentStatus: pRef >= toCents(payment.amount) ? 'REFUNDED' : 'PARTIALLY_REFUNDED' } });
  const booking = await tx.booking.findUnique({ where: { id: payment.bookingId } });
  const bRef = fromCents(toCents(booking.amountRefunded) + toCents(refund.amount));
  await tx.booking.update({ where: { id: booking.id }, data: { amountRefunded: bRef, paymentStatus: bookingService.derivePaymentStatus(booking.totalAmount, booking.amountPaid, bRef) } });
  return refund;
}

async function notifyRefund(refundId) {
  const refund = await prisma.refund.findUnique({ where: { id: refundId }, include: { payment: { include: { booking: true } } } });
  const booking = refund.payment.booking;
  await notifications.notify(booking.userId, { title: `Refund ${refund.refundStatus.toLowerCase()}`, message: `Refund of ₱${refund.amount} for ${booking.bookingReference}: ${refund.refundStatus.toLowerCase()}.`, type: 'PAYMENT', bookingId: booking.id });
  await email.send('refundUpdate', booking.guestEmail, { booking, refund }, booking.guestFirstName);
}

/** Refund (part of) one payment. Reserves the amount first so concurrent refunds can't exceed what was paid. */
async function refundPayment(req, paymentId, { amount, reason }) {
  const refund = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM payments WHERE id = ${paymentId} FOR UPDATE`;
    const payment = await tx.payment.findUnique({ where: { id: paymentId }, include: { refunds: true } });
    if (!payment) throw AppError.notFound('Payment not found.');
    if (!['PAID', 'PARTIALLY_REFUNDED'].includes(payment.paymentStatus)) throw AppError.conflict('Only paid payments can be refunded.');
    const reserved = payment.refunds.filter((r) => r.refundStatus !== 'FAILED').reduce((s, r) => s + toCents(r.amount), 0);
    const refundable = toCents(payment.amount) - reserved;
    if (toCents(amount) > refundable) throw AppError.badRequest(`Refund cannot exceed ${pesoCents(refundable)} for this payment.`, { fields: { amount: `Max ${pesoCents(refundable)}` } });
    return tx.refund.create({ data: { paymentId, amount: fromCents(toCents(amount)), reason, refundStatus: 'PENDING', processedById: req.user.id } });
  });

  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  let status = 'SUCCEEDED';
  let providerReference = null;
  try {
    if (payment.provider !== 'FRONT_DESK') {
      const provider = providerByName[payment.provider];
      if (!provider) throw AppError.badRequest(`Refunds for provider ${payment.provider} are not supported.`);
      ({ status, providerReference } = await provider.refund({ payment, amount, reason }));
    }
  } catch (err) {
    await prisma.refund.update({ where: { id: refund.id }, data: { refundStatus: 'FAILED', reason: `${reason} — ${String(err.message).slice(0, 120)}` } });
    await audit.log(req, 'REFUND_FAILED', { entityType: 'refund', entityId: refund.id, description: err.message });
    throw err;
  }
  await prisma.$transaction(async (tx) => {
    await tx.refund.update({ where: { id: refund.id }, data: { providerReference } });
    if (status !== 'PENDING') await settleRefund(tx, refund.id, status);
  });
  await audit.log(req, 'REFUND_ISSUED', { entityType: 'refund', entityId: refund.id, description: `${payment.paymentReference} ₱${amount} (${status}) — ${reason}` });
  await notifyRefund(refund.id);
  return serialize(await prisma.refund.findUnique({ where: { id: refund.id } }));
}

/** Refund an amount against a booking, spreading it across its paid payments (newest first). */
async function refundBooking(req, booking, amount, reason) {
  let remaining = toCents(amount);
  const payments = await prisma.payment.findMany({ where: { bookingId: booking.id, paymentStatus: { in: ['PAID', 'PARTIALLY_REFUNDED'] } }, include: { refunds: true }, orderBy: { paidAt: 'desc' } });
  const results = [];
  for (const p of payments) {
    if (remaining <= 0) break;
    const reserved = p.refunds.filter((r) => r.refundStatus !== 'FAILED').reduce((s, r) => s + toCents(r.amount), 0);
    const can = toCents(p.amount) - reserved;
    if (can <= 0) continue;
    const take = Math.min(can, remaining);
    results.push(await refundPayment(req, p.id, { amount: Number(fromCents(take)), reason }));
    remaining -= take;
  }
  if (remaining > 0) throw AppError.badRequest(`Could only refund part of the amount; ${pesoCents(remaining)} exceeds what was paid.`);
  return results;
}

// ───────────────────────────── Queries ─────────────────────────────

async function getById(user, id) {
  const payment = await prisma.payment.findUnique({ where: { id }, include: { refunds: true, booking: { select: { id: true, userId: true, bookingReference: true, guestFirstName: true, guestLastName: true, totalAmount: true } }, recordedBy: { select: { firstName: true, lastName: true } } } });
  if (!payment || (user.role === 'CUSTOMER' && payment.booking.userId !== user.id)) throw AppError.notFound('Payment not found.');
  const s = serialize(payment);
  if (user.role === 'CUSTOMER') { delete s.recorded_by; delete s.checkout_url; delete s.provider_session_id; }
  return s;
}

function adminWhere(q) {
  const where = { AND: [] };
  if (q.status) where.AND.push({ paymentStatus: { in: q.status.split(',').filter((s) => /^[A-Z_]+$/.test(s)) } });
  if (q.q) where.AND.push({ OR: [{ paymentReference: { contains: q.q } }, { booking: { bookingReference: { contains: q.q } } }, { booking: { guestLastName: { contains: q.q } } }, { booking: { guestFirstName: { contains: q.q } } }] });
  if (q.from) where.AND.push({ createdAt: { gte: parseDate(q.from) } });
  if (q.to) where.AND.push({ createdAt: { lt: addDays(parseDate(q.to), 1) } });
  return where;
}

async function listAdmin(q = {}) {
  const where = adminWhere(q);
  const pg = getPagination(q);
  const [rows, total, sums] = await Promise.all([
    prisma.payment.findMany({ where, include: { refunds: true, booking: { select: { id: true, bookingReference: true, guestFirstName: true, guestLastName: true } }, recordedBy: { select: { firstName: true, lastName: true } } }, orderBy: { createdAt: 'desc' }, skip: pg.skip, take: pg.take }),
    prisma.payment.count({ where }),
    prisma.payment.aggregate({ where: { ...where, paymentStatus: { in: ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'] } }, _sum: { amount: true, amountRefunded: true } }),
  ]);
  const collected = Number(sums._sum.amount || 0);
  const refunded = Number(sums._sum.amountRefunded || 0);
  return { ...paged(serialize(rows), total, pg), totals: { collected, refunded, net: Number((collected - refunded).toFixed(2)) } };
}

// ───────────────────────────── Mock checkout (dev only) ─────────────────────────────

async function mockSession(user, sessionId) {
  if (env.payments.provider !== 'mock') throw AppError.notFound();
  const payment = await prisma.payment.findUnique({ where: { providerSessionId: sessionId }, include: { booking: true } });
  if (!payment || (user.role === 'CUSTOMER' && payment.booking.userId !== user.id)) throw AppError.notFound('Checkout session not found.');
  return {
    session_id: sessionId, payment_reference: payment.paymentReference, amount: Number(payment.amount), status: payment.paymentStatus,
    booking_id: payment.bookingId, booking_reference: payment.booking.bookingReference, expires_at: payment.booking.expiresAt,
  };
}

async function mockComplete(user, sessionId, { outcome, method }) {
  const s = await mockSession(user, sessionId);
  if (s.status !== 'PENDING') throw AppError.conflict('This checkout session has already been completed.');
  const { raw, headers } = providers.mock.buildEvent({ sessionId, outcome, method, amount: s.amount });
  await handleWebhook(raw, headers, providers.mock);
  return { redirect_url: `/payment-result.html?booking=${s.booking_id}&status=${outcome === 'paid' ? 'success' : 'cancelled'}` };
}

module.exports = { createCheckout, handleWebhook, recordFrontDeskPayment, refundPayment, refundBooking, getById, listAdmin, adminWhere, mockSession, mockComplete, currentProvider, providers };
