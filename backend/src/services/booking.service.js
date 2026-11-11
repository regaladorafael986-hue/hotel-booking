const { Prisma } = require('@prisma/client');
const prisma = require('../config/prisma');
const env = require('../config/env');
const AppError = require('../utils/AppError');
const { serialize } = require('../utils/serialize');
const { toCents, fromCents, pesoCents } = require('../utils/money');
const { randomCode } = require('../utils/crypto');
const { hotelToday, hotelDateTime, addDays, parseDate, formatDate } = require('../utils/dates');
const { getPagination, paged } = require('../utils/pagination');
const availability = require('./availability.service');
const pricing = require('./pricing.service');
const hotel = require('./hotel.service');
const email = require('./email.service');
const notifications = require('./notification.service');
const audit = require('./audit.service');

const TX_OPTS = { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 20000, maxWait: 10000 };
const MAX_OPEN_HOLDS_PER_USER = 3;

const include = {
  rooms: { include: { room: { select: { id: true, roomNumber: true, floor: true, housekeepingStatus: true } }, roomType: { select: { id: true, name: true, slug: true, bedType: true, images: { where: { isPrimary: true }, take: 1 } } } }, orderBy: { id: 'asc' } },
  payments: { include: { refunds: { orderBy: { createdAt: 'desc' } }, recordedBy: { select: { firstName: true, lastName: true } } }, orderBy: { createdAt: 'desc' } },
  review: true,
  user: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
  createdBy: { select: { id: true, firstName: true, lastName: true, role: true } },
};

/** Retry a transaction on deadlock / write-conflict. */
async function withRetry(fn, attempts = 3) {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      // P2034 = write conflict / deadlock; PostgreSQL: 40001 serialization failure, 40P01 deadlock detected.
      const retriable = err?.code === 'P2034' || /deadlock|lock wait timeout|could not serialize|40001|40P01/i.test(err?.message || '');
      if (!retriable || i >= attempts) throw err;
      await new Promise((r) => setTimeout(r, 40 * i + Math.random() * 60));
    }
  }
}

async function generateReference(tx) {
  for (let i = 0; i < 6; i++) {
    const ref = `SE-${randomCode(8)}`;
    if (!(await tx.booking.findUnique({ where: { bookingReference: ref }, select: { id: true } }))) return ref;
  }
  throw new Error('Could not generate a unique booking reference');
}

function derivePaymentStatus(total, paid, refunded, current) {
  const t = toCents(total), p = toCents(paid), r = toCents(refunded);
  if (r > 0 && r >= p) return 'REFUNDED';
  if (r > 0) return 'PARTIALLY_REFUNDED';
  if (p >= t && t > 0) return 'PAID';
  return current === 'FAILED' && p === 0 ? 'FAILED' : 'PENDING';
}

/** Shape a booking for API responses, adding computed fields the UI relies on. */
function present(b, settings, viewer) {
  const s = serialize(b);
  const balance = Math.max(0, toCents(b.totalAmount) - toCents(b.amountPaid));
  s.balance_due = Number(fromCents(balance));
  s.room_summary = Object.values((b.rooms || []).reduce((acc, r) => {
    const k = r.roomTypeId;
    acc[k] = acc[k] || { room_type_id: k, name: r.roomType?.name, quantity: 0, nightly_rate: Number(r.nightlyRate) };
    acc[k].quantity++;
    return acc;
  }, {}));
  const today = hotelToday();
  const activeUnstarted = ['PENDING_PAYMENT', 'PENDING_CONFIRMATION', 'CONFIRMED'].includes(b.bookingStatus);
  const checkInAt = settings ? hotelDateTime(b.checkIn, settings.checkInTime) : null;
  const hoursToCheckIn = checkInAt ? (checkInAt.getTime() - Date.now()) / 36e5 : null;
  const freeHours = settings?.freeCancellationHours ?? 48;
  s.within_free_cancellation = hoursToCheckIn !== null ? hoursToCheckIn >= freeHours : null;
  s.suggested_refund = Number(b.amountPaid) > 0 && s.within_free_cancellation ? Number(fromCents(toCents(b.amountPaid) - toCents(b.amountRefunded))) : 0;
  s.can_cancel = activeUnstarted && b.cancellationStatus !== 'REQUESTED' && b.checkIn >= today;
  s.cancel_needs_review = s.can_cancel && toCents(b.amountPaid) > 0;
  s.can_pay = b.bookingStatus === 'PENDING_PAYMENT' && b.paymentMethod === 'ONLINE' && b.expiresAt && b.expiresAt > new Date() && balance > 0;
  s.can_review = b.bookingStatus === 'CHECKED_OUT' && !b.review && Boolean(b.userId);
  s.unassigned_rooms = 0;
  if (viewer && viewer.role === 'CUSTOMER') {
    delete s.created_by;
    for (const p of s.payments || []) { delete p.recorded_by; delete p.recorded_by_id; delete p.checkout_url; delete p.provider_session_id; }
  }
  return s;
}

function assertCanView(user, booking) {
  if (!booking) throw AppError.notFound('Booking not found.');
  if (user.role === 'CUSTOMER' && booking.userId !== user.id) throw AppError.notFound('Booking not found.'); // 404, not 403: don't leak existence
}

// ───────────────────────────── Create ─────────────────────────────

/**
 * Create a reservation atomically:
 *   lock categories → (lock coupon) → recompute price from DB → pick free physical rooms → insert booking + rooms.
 * @param {object} opts { source, userId, actor, paymentMethod, autoConfirm, allowSameDay }
 */
async function create(req, data, opts = {}) {
  const settings = await hotel.getSettings();
  const source = opts.source || 'ONLINE';
  const paymentMethod = opts.paymentMethod || data.payment_method;
  const typeIds = data.items.map((i) => i.room_type_id);
  const couponCode = data.coupon_code ? data.coupon_code.toUpperCase() : null;

  if (source === 'ONLINE' && opts.userId) {
    const openHolds = await prisma.booking.count({ where: { userId: opts.userId, bookingStatus: 'PENDING_PAYMENT', expiresAt: { gt: new Date() } } });
    if (openHolds >= MAX_OPEN_HOLDS_PER_USER) throw AppError.conflict('You have several unpaid reservations on hold. Please complete or cancel them before making another.');
  }

  const booking = await withRetry(() => prisma.$transaction(async (tx) => {
    await availability.lockRoomTypes(tx, typeIds);
    if (couponCode) await tx.$queryRaw`SELECT id FROM coupons WHERE code = ${couponCode} FOR UPDATE`;

    const q = await pricing.quote({ ...data, coupon_code: couponCode }, { client: tx, settings });
    const now = new Date();

    // Pick specific free rooms for every unit requested; fail the whole booking if any category is short.
    const units = [];
    for (const line of q.lines) {
      const free = await availability.findFreeRooms(tx, { roomTypeId: line.room_type_id, checkIn: q.checkIn, checkOut: q.checkOut, limit: line.quantity, now });
      if (free.length < line.quantity) {
        throw AppError.conflict(free.length
          ? `Only ${free.length} ${line.name} room(s) are left for those dates. Please reduce the quantity or choose different dates.`
          : `Sorry — ${line.name} is fully booked for those dates.`, { room_type_id: line.room_type_id, available: free.length });
      }
      for (const room of free) units.push({ room, line, maxAdults: line._roomType.maxAdults, maxChildren: line._roomType.maxChildren });
    }
    const split = pricing.distributeGuests(units, data.adults, data.children || 0);

    let status;
    let expiresAt = null;
    if (paymentMethod === 'ONLINE') {
      status = 'PENDING_PAYMENT';
      expiresAt = new Date(now.getTime() + settings.holdMinutes * 60000);
    } else {
      const auto = opts.autoConfirm ?? settings.payAtHotelAutoConfirm;
      status = auto ? 'CONFIRMED' : 'PENDING_CONFIRMATION';
    }

    const created = await tx.booking.create({
      data: {
        bookingReference: await generateReference(tx),
        userId: opts.userId ?? null,
        createdById: opts.actor?.id ?? null,
        source,
        guestFirstName: data.guest.first_name,
        guestLastName: data.guest.last_name,
        guestEmail: data.guest.email,
        guestPhone: data.guest.phone || null,
        specialRequests: data.special_requests || null,
        checkIn: q.checkIn,
        checkOut: q.checkOut,
        nights: q.nights,
        adults: data.adults,
        children: data.children || 0,
        totalRooms: q.totalRooms,
        subtotal: q.amounts.subtotal,
        discount: q.amounts.discount,
        taxes: q.amounts.taxes,
        totalAmount: q.amounts.total,
        couponId: q.coupon?.id ?? null,
        couponCode: q.coupon?.code ?? null,
        bookingStatus: status,
        paymentStatus: 'PENDING',
        paymentMethod,
        expiresAt,
        confirmedAt: status === 'CONFIRMED' ? now : null,
        rooms: {
          create: units.map((u, i) => ({ roomId: u.room.id, roomTypeId: u.line.room_type_id, nightlyRate: fromCents(u.line._rateCents), adults: split[i].adults, children: split[i].children })),
        },
      },
      include,
    });
    if (q.coupon) await tx.coupon.update({ where: { id: q.coupon.id }, data: { usedCount: { increment: 1 } } });
    return created;
  }, TX_OPTS));

  await audit.log(req, source === 'WALK_IN' ? 'WALK_IN_CREATED' : 'BOOKING_CREATED', { entityType: 'booking', entityId: booking.id, description: `${booking.bookingReference} ${booking.bookingStatus} ₱${booking.totalAmount}` });
  await afterStatusChange(booking, settings);
  return present(booking, settings, req.user);
}

/** Customer/guest-facing notifications for a booking's current status. */
async function afterStatusChange(booking, settings) {
  const ref = booking.bookingReference;
  const n = (title, message, type = 'BOOKING') => notifications.notify(booking.userId, { title, message, type, bookingId: booking.id });
  switch (booking.bookingStatus) {
    case 'PENDING_PAYMENT':
      await n('Complete your payment', `Your rooms for ${ref} are held until ${booking.expiresAt.toLocaleTimeString('en-PH', { timeZone: env.timezone, hour: '2-digit', minute: '2-digit' })}. Complete payment to confirm.`, 'PAYMENT');
      break;
    case 'PENDING_CONFIRMATION':
      await n('Reservation received', `Reservation ${ref} is awaiting confirmation from the hotel.`);
      await email.send('bookingReceived', booking.guestEmail, { booking }, booking.guestFirstName);
      break;
    case 'CONFIRMED':
      await n('Booking confirmed', `Your reservation ${ref} for ${formatDate(booking.checkIn)} is confirmed.`);
      await email.send('bookingConfirmed', booking.guestEmail, { booking, settings }, booking.guestFirstName);
      break;
    default:
  }
}

// ───────────────────────────── Read ─────────────────────────────

async function getById(user, id) {
  const [booking, settings] = await Promise.all([prisma.booking.findUnique({ where: { id }, include }), hotel.getSettings()]);
  assertCanView(user, booking);
  return present(booking, settings, user);
}

async function getRaw(id, client = prisma) {
  const b = await client.booking.findUnique({ where: { id }, include });
  if (!b) throw AppError.notFound('Booking not found.');
  return b;
}

async function listMine(user, q = {}) {
  const today = hotelToday();
  const where = { userId: user.id };
  switch (q.status) {
    case 'upcoming': where.bookingStatus = { in: ['PENDING_PAYMENT', 'PENDING_CONFIRMATION', 'CONFIRMED'] }; where.checkOut = { gt: today }; break;
    case 'current': where.bookingStatus = 'CHECKED_IN'; break;
    case 'completed': where.bookingStatus = 'CHECKED_OUT'; break;
    case 'cancelled': where.bookingStatus = { in: ['CANCELLED', 'EXPIRED'] }; break;
    case undefined: case '': case 'all': break;
    default: if (/^[A-Z_]+$/.test(q.status)) where.bookingStatus = q.status;
  }
  const pg = getPagination(q, { defaultSize: 10 });
  const [rows, total, settings] = await Promise.all([
    prisma.booking.findMany({ where, include, orderBy: { checkIn: 'desc' }, skip: pg.skip, take: pg.take }),
    prisma.booking.count({ where }),
    hotel.getSettings(),
  ]);
  return paged(rows.map((b) => present(b, settings, user)), total, pg);
}

function adminWhere(q) {
  const where = { AND: [] };
  if (q.q) {
    const term = q.q.trim();
    const parts = term.split(/\s+/);
    where.AND.push({
      OR: [
        { bookingReference: { contains: term, mode: 'insensitive' } },
        { guestEmail: { contains: term, mode: 'insensitive' } },
        { guestPhone: { contains: term, mode: 'insensitive' } },
        { guestFirstName: { contains: term, mode: 'insensitive' } },
        { guestLastName: { contains: term, mode: 'insensitive' } },
        ...(parts.length > 1 ? [{ AND: [{ guestFirstName: { contains: parts[0], mode: 'insensitive' } }, { guestLastName: { contains: parts.slice(1).join(' '), mode: 'insensitive' } }] }] : []),
      ],
    });
  }
  if (q.status) where.AND.push({ bookingStatus: { in: q.status.split(',').filter((s) => /^[A-Z_]+$/.test(s)) } });
  if (q.payment_status) where.AND.push({ paymentStatus: { in: q.payment_status.split(',').filter((s) => /^[A-Z_]+$/.test(s)) } });
  if (q.cancellation_status) where.AND.push({ cancellationStatus: q.cancellation_status });
  const field = { check_in: 'checkIn', check_out: 'checkOut', created_at: 'createdAt' }[q.date_field || 'check_in'];
  if (q.from) where.AND.push({ [field]: { gte: parseDate(q.from, 'From') } });
  if (q.to) where.AND.push({ [field]: { [field === 'createdAt' ? 'lt' : 'lte']: field === 'createdAt' ? addDays(parseDate(q.to, 'To'), 1) : parseDate(q.to, 'To') } });
  return where;
}

async function listAdmin(user, q = {}) {
  const where = adminWhere(q);
  const pg = getPagination(q);
  const orderBy = { [{ created_at: 'createdAt', check_in: 'checkIn', check_out: 'checkOut', total_amount: 'totalAmount' }[q.sort || 'created_at']]: q.order || 'desc' };
  const [rows, total, settings] = await Promise.all([
    prisma.booking.findMany({ where, include, orderBy, skip: pg.skip, take: pg.take }),
    prisma.booking.count({ where }),
    hotel.getSettings(),
  ]);
  return paged(rows.map((b) => present(b, settings, user)), total, pg);
}

// ───────────────────────────── Status changes ─────────────────────────────

/** Cancel inside a transaction; releases inventory (by status) and the coupon use. */
async function cancelTx(tx, booking, { reason, cancellationStatus }) {
  const res = await tx.booking.updateMany({
    where: { id: booking.id, bookingStatus: { in: ['PENDING_PAYMENT', 'PENDING_CONFIRMATION', 'CONFIRMED'] } },
    data: { bookingStatus: 'CANCELLED', cancelledAt: new Date(), cancellationReason: reason || booking.cancellationReason, cancellationStatus: cancellationStatus || booking.cancellationStatus, expiresAt: null },
  });
  if (res.count === 0) throw AppError.conflict('This booking can no longer be cancelled.');
  if (booking.couponId) await tx.coupon.updateMany({ where: { id: booking.couponId, usedCount: { gt: 0 } }, data: { usedCount: { decrement: 1 } } });
  await tx.payment.updateMany({ where: { bookingId: booking.id, paymentStatus: 'PENDING' }, data: { paymentStatus: 'FAILED', failureReason: 'Booking cancelled' } });
}

async function notifyCancelled(booking, reason) {
  await notifications.notify(booking.userId, { title: 'Booking cancelled', message: `Reservation ${booking.bookingReference} has been cancelled.`, type: 'BOOKING', bookingId: booking.id });
  await email.send('bookingCancelled', booking.guestEmail, { booking, reason }, booking.guestFirstName);
}

/**
 * Customer cancellation. Unpaid bookings are cancelled immediately;
 * bookings with money already paid become a cancellation *request* for the hotel to review (and refund).
 */
async function cancelByCustomer(req, id, reason) {
  const booking = await getRaw(id);
  assertCanView(req.user, booking);
  const settings = await hotel.getSettings();
  const view = present(booking, settings, req.user);
  if (booking.cancellationStatus === 'REQUESTED') throw AppError.conflict('A cancellation request for this booking is already being reviewed.');
  if (!view.can_cancel) throw AppError.conflict('This booking can no longer be cancelled online. Please contact the front desk.');

  if (toCents(booking.amountPaid) === 0) {
    await prisma.$transaction((tx) => cancelTx(tx, booking, { reason, cancellationStatus: 'APPROVED' }), TX_OPTS);
    await audit.log(req, 'BOOKING_CANCELLED', { entityType: 'booking', entityId: id, description: `${booking.bookingReference} cancelled by customer: ${reason}` });
    const fresh = await getRaw(id);
    await notifyCancelled(fresh, reason);
    return { result: 'CANCELLED', booking: present(fresh, settings, req.user) };
  }

  await prisma.booking.update({ where: { id }, data: { cancellationStatus: 'REQUESTED', cancellationReason: reason, cancellationRequestedAt: new Date() } });
  await audit.log(req, 'CANCELLATION_REQUESTED', { entityType: 'booking', entityId: id, description: `${booking.bookingReference}: ${reason}` });
  await notifications.notify(booking.userId, { title: 'Cancellation requested', message: `We received your cancellation request for ${booking.bookingReference}. The hotel will review it shortly.`, type: 'BOOKING', bookingId: id });
  await notifications.notifyAdmins({ title: 'New cancellation request', message: `${booking.bookingReference} (${booking.guestFirstName} ${booking.guestLastName}) requested cancellation.`, type: 'BOOKING', bookingId: id });
  return { result: 'REQUESTED', booking: present(await getRaw(id), settings, req.user) };
}

/** Admin: confirm a pending pay-at-hotel reservation, or cancel a reservation. */
async function adminSetStatus(req, id, { status, reason }) {
  const booking = await getRaw(id);
  const settings = await hotel.getSettings();
  if (status === 'CONFIRMED') {
    if (booking.bookingStatus !== 'PENDING_CONFIRMATION') throw AppError.conflict(`Only reservations awaiting confirmation can be confirmed (current status: ${booking.bookingStatus}).`);
    await prisma.booking.update({ where: { id }, data: { bookingStatus: 'CONFIRMED', confirmedAt: new Date() } });
    await audit.log(req, 'BOOKING_CONFIRMED', { entityType: 'booking', entityId: id, description: booking.bookingReference });
    const fresh = await getRaw(id);
    await afterStatusChange(fresh, settings);
    return present(fresh, settings, req.user);
  }
  // CANCELLED
  if (!['PENDING_PAYMENT', 'PENDING_CONFIRMATION', 'CONFIRMED'].includes(booking.bookingStatus)) throw AppError.conflict(`A ${booking.bookingStatus.replace('_', ' ').toLowerCase()} booking cannot be cancelled.`);
  await prisma.$transaction((tx) => cancelTx(tx, booking, { reason: reason || 'Cancelled by the hotel', cancellationStatus: booking.cancellationStatus === 'REQUESTED' ? 'APPROVED' : booking.cancellationStatus }), TX_OPTS);
  await audit.log(req, 'BOOKING_CANCELLED', { entityType: 'booking', entityId: id, description: `${booking.bookingReference} cancelled by hotel${reason ? `: ${reason}` : ''}` });
  const fresh = await getRaw(id);
  await notifyCancelled(fresh, reason);
  return present(fresh, settings, req.user);
}

/** Admin review of a customer's cancellation request, with optional refund. */
async function reviewCancellation(req, id, { approve, note, refund_amount }) {
  const booking = await getRaw(id);
  if (booking.cancellationStatus !== 'REQUESTED') throw AppError.conflict('There is no pending cancellation request for this booking.');
  const settings = await hotel.getSettings();
  if (!approve) {
    await prisma.booking.update({ where: { id }, data: { cancellationStatus: 'REJECTED', cancellationNote: note || null } });
    await audit.log(req, 'CANCELLATION_REJECTED', { entityType: 'booking', entityId: id, description: `${booking.bookingReference}${note ? `: ${note}` : ''}` });
    await notifications.notify(booking.userId, { title: 'Cancellation request declined', message: `Your cancellation request for ${booking.bookingReference} was declined.${note ? ` ${note}` : ''}`, type: 'BOOKING', bookingId: id });
    await email.send('cancellationUpdate', booking.guestEmail, { booking, approved: false, note }, booking.guestFirstName);
    return present(await getRaw(id), settings, req.user);
  }
  const refundable = toCents(booking.amountPaid) - toCents(booking.amountRefunded);
  if (refund_amount && toCents(refund_amount) > refundable) throw AppError.badRequest(`Refund cannot exceed the refundable amount of ${pesoCents(refundable)}.`);

  await prisma.$transaction(async (tx) => {
    await cancelTx(tx, booking, { reason: booking.cancellationReason, cancellationStatus: 'APPROVED' });
    await tx.booking.update({ where: { id }, data: { cancellationNote: note || null } });
  }, TX_OPTS);
  await audit.log(req, 'CANCELLATION_APPROVED', { entityType: 'booking', entityId: id, description: `${booking.bookingReference}; refund ₱${refund_amount || 0}` });
  let fresh = await getRaw(id);
  await notifications.notify(booking.userId, { title: 'Cancellation approved', message: `Your cancellation request for ${booking.bookingReference} was approved.`, type: 'BOOKING', bookingId: id });
  await email.send('cancellationUpdate', booking.guestEmail, { booking: fresh, approved: true, note }, booking.guestFirstName);

  if (refund_amount && refund_amount > 0) {
    const paymentService = require('./payment.service');
    await paymentService.refundBooking(req, fresh, refund_amount, `Cancellation: ${booking.cancellationReason || 'approved request'}`);
    fresh = await getRaw(id);
  }
  return present(fresh, settings, req.user);
}

// ───────────────────────────── Front desk ─────────────────────────────

async function checkIn(req, id, { override_housekeeping } = {}) {
  const booking = await getRaw(id);
  const settings = await hotel.getSettings();
  const today = hotelToday();
  if (booking.bookingStatus === 'PENDING_CONFIRMATION') throw AppError.conflict('Confirm this reservation before checking the guest in.');
  if (booking.bookingStatus !== 'CONFIRMED') throw AppError.conflict(`Only confirmed reservations can be checked in (current status: ${booking.bookingStatus}).`);
  if (booking.checkIn > today) throw AppError.conflict(`This reservation starts on ${formatDate(booking.checkIn)}. Early check-in is not available before the arrival date.`);
  if (booking.checkOut <= today) throw AppError.conflict('This reservation\'s stay dates have already passed.');
  const notReady = booking.rooms.filter((r) => r.room.housekeepingStatus !== 'CLEAN');
  const maint = notReady.filter((r) => r.room.housekeepingStatus === 'MAINTENANCE');
  if (maint.length) throw AppError.conflict(`Room ${maint.map((r) => r.room.roomNumber).join(', ')} is under maintenance. Reassign the guest to another room first.`);
  if (notReady.length && !override_housekeeping) {
    throw new AppError(409, `Room ${notReady.map((r) => `${r.room.roomNumber} (${r.room.housekeepingStatus.toLowerCase()})`).join(', ')} is not marked clean yet.`, { code: 'ROOM_NOT_READY' });
  }
  const res = await prisma.booking.updateMany({ where: { id, bookingStatus: 'CONFIRMED' }, data: { bookingStatus: 'CHECKED_IN', checkedInAt: new Date() } });
  if (!res.count) throw AppError.conflict('The booking status changed. Refresh and try again.');
  await audit.log(req, 'GUEST_CHECKED_IN', { entityType: 'booking', entityId: id, description: `${booking.bookingReference}: rooms ${booking.rooms.map((r) => r.room.roomNumber).join(', ')}` });
  await notifications.notify(booking.userId, { title: 'Welcome!', message: `You're checked in for ${booking.bookingReference}. Enjoy your stay.`, type: 'BOOKING', bookingId: id });
  return present(await getRaw(id), settings, req.user);
}

async function checkOut(req, id) {
  const booking = await getRaw(id);
  const settings = await hotel.getSettings();
  if (booking.bookingStatus !== 'CHECKED_IN') throw AppError.conflict(`Only checked-in guests can be checked out (current status: ${booking.bookingStatus}).`);
  const balance = toCents(booking.totalAmount) - toCents(booking.amountPaid);
  if (balance > 0) throw new AppError(409, `Collect the outstanding balance of ${pesoCents(balance)} before check-out.`, { code: 'BALANCE_DUE', details: { balance_due: Number(fromCents(balance)) } });
  await prisma.$transaction(async (tx) => {
    const res = await tx.booking.updateMany({ where: { id, bookingStatus: 'CHECKED_IN' }, data: { bookingStatus: 'CHECKED_OUT', checkedOutAt: new Date() } });
    if (!res.count) throw AppError.conflict('The booking status changed. Refresh and try again.');
    await tx.room.updateMany({ where: { id: { in: booking.rooms.map((r) => r.roomId) }, housekeepingStatus: { not: 'MAINTENANCE' } }, data: { housekeepingStatus: 'DIRTY' } });
  });
  await audit.log(req, 'GUEST_CHECKED_OUT', { entityType: 'booking', entityId: id, description: booking.bookingReference });
  await notifications.notify(booking.userId, { title: 'Thank you for staying with us', message: `You've checked out of ${booking.bookingReference}. We'd love to hear about your stay — leave a review from your dashboard.`, type: 'BOOKING', bookingId: id });
  return present(await getRaw(id), settings, req.user);
}

/** Rooms a booking-room line can be moved to (free for the whole stay, any active category). */
async function assignableRooms(id, bookingRoomId) {
  const booking = await getRaw(id);
  const line = booking.rooms.find((r) => r.id === bookingRoomId);
  if (!line) throw AppError.notFound('Room line not found on this booking.');
  const types = await prisma.roomType.findMany({ where: { status: 'ACTIVE' }, select: { id: true, name: true } });
  const out = [];
  for (const t of types) {
    const free = await availability.findFreeRooms(prisma, { roomTypeId: t.id, checkIn: booking.checkIn, checkOut: booking.checkOut, excludeBookingId: booking.id });
    const taken = new Set(booking.rooms.filter((r) => r.id !== bookingRoomId).map((r) => r.roomId));
    for (const r of free) if (!taken.has(r.id)) out.push({ ...r, room_type_id: t.id, room_type_name: t.name, same_type: t.id === line.roomTypeId, current: r.id === line.roomId });
  }
  if (!out.some((r) => r.id === line.roomId)) out.unshift({ id: line.roomId, roomNumber: line.room.roomNumber, floor: line.room.floor, housekeepingStatus: line.room.housekeepingStatus, room_type_id: line.roomTypeId, room_type_name: line.roomType.name, same_type: true, current: true });
  return out.sort((a, b) => Number(b.same_type) - Number(a.same_type) || a.floor - b.floor || a.roomNumber.localeCompare(b.roomNumber));
}

/** Move one room line of a booking to a different physical room, under lock. */
async function assignRoom(req, id, { booking_room_id, room_id }) {
  const settings = await hotel.getSettings();
  const booking = await getRaw(id);
  if (!['PENDING_PAYMENT', 'PENDING_CONFIRMATION', 'CONFIRMED', 'CHECKED_IN'].includes(booking.bookingStatus)) throw AppError.conflict('Rooms can only be assigned on active reservations.');
  const line = booking.rooms.find((r) => r.id === booking_room_id);
  if (!line) throw AppError.notFound('Room line not found on this booking.');
  if (line.roomId === room_id) return present(booking, settings, req.user);
  const target = await prisma.room.findUnique({ where: { id: room_id }, include: { roomType: true } });
  if (!target || !target.isActive || target.roomType.status !== 'ACTIVE') throw AppError.badRequest('That room is not available for assignment.');
  if (target.housekeepingStatus === 'MAINTENANCE') throw AppError.badRequest(`Room ${target.roomNumber} is under maintenance.`);

  await withRetry(() => prisma.$transaction(async (tx) => {
    await availability.lockRoomTypes(tx, [line.roomTypeId, target.roomTypeId]);
    const free = await availability.isRoomFree(tx, { roomId: room_id, checkIn: booking.checkIn, checkOut: booking.checkOut, excludeBookingId: booking.id });
    const dupInBooking = booking.rooms.some((r) => r.id !== booking_room_id && r.roomId === room_id);
    if (!free || dupInBooking) throw AppError.conflict(`Room ${target.roomNumber} is already reserved for part of this stay.`);
    await tx.bookingRoom.update({ where: { id: booking_room_id }, data: { roomId: room_id } });
    if (booking.bookingStatus === 'CHECKED_IN') {
      await tx.room.updateMany({ where: { id: line.roomId, housekeepingStatus: { not: 'MAINTENANCE' } }, data: { housekeepingStatus: 'DIRTY' } });
    }
  }, TX_OPTS));
  await audit.log(req, 'ROOM_ASSIGNED', { entityType: 'booking', entityId: id, description: `${booking.bookingReference}: room ${line.room.roomNumber} → ${target.roomNumber}` });
  return present(await getRaw(id), settings, req.user);
}

async function arrivals(user, dateStr) {
  const date = dateStr ? parseDate(dateStr) : hotelToday();
  const settings = await hotel.getSettings();
  const rows = await prisma.booking.findMany({ where: { checkIn: date, bookingStatus: { in: ['PENDING_CONFIRMATION', 'CONFIRMED', 'CHECKED_IN'] } }, include, orderBy: [{ bookingStatus: 'asc' }, { guestLastName: 'asc' }] });
  return rows.map((b) => present(b, settings, user));
}

async function departures(user, dateStr) {
  const date = dateStr ? parseDate(dateStr) : hotelToday();
  const settings = await hotel.getSettings();
  const rows = await prisma.booking.findMany({
    where: { OR: [{ checkOut: date, bookingStatus: { in: ['CHECKED_IN', 'CHECKED_OUT'] } }, ...(dateStr ? [] : [{ checkOut: { lt: date }, bookingStatus: 'CHECKED_IN' }])] },
    include,
    orderBy: [{ bookingStatus: 'asc' }, { guestLastName: 'asc' }],
  });
  return rows.map((b) => present(b, settings, user));
}

async function inHouse(user) {
  const settings = await hotel.getSettings();
  const rows = await prisma.booking.findMany({ where: { bookingStatus: 'CHECKED_IN' }, include, orderBy: { checkOut: 'asc' } });
  return rows.map((b) => present(b, settings, user));
}

/** Front-desk reservation for a guest at the counter (optionally checks in & takes payment immediately). */
async function walkIn(req, data) {
  let userId = null;
  if (data.user_id) {
    const u = await prisma.user.findUnique({ where: { id: data.user_id } });
    if (!u || u.role !== 'CUSTOMER') throw AppError.badRequest('Linked customer account not found.');
    userId = u.id;
  } else {
    const u = await prisma.user.findUnique({ where: { email: data.guest.email } });
    if (u && u.role === 'CUSTOMER') userId = u.id; // link to the existing account so it appears in their history
  }
  const booking = await create(req, data, { source: 'WALK_IN', userId, actor: req.user, paymentMethod: 'PAY_AT_HOTEL', autoConfirm: true });
  // The reservation now exists; follow-up steps report warnings instead of failing the whole request.
  const warnings = [];
  if (data.collect_payment && data.collect_payment.amount > 0) {
    const { hasPermission } = require('../middleware/auth');
    if (!hasPermission(req.user, 'collect_payment')) warnings.push('Payment was not recorded: your account lacks the collect-payment permission.');
    else {
      try {
        await require('./payment.service').recordFrontDeskPayment(req, { booking_id: booking.id, ...data.collect_payment });
      } catch (err) { warnings.push(`Payment was not recorded: ${err.message}`); }
    }
  }
  if (data.check_in_now) {
    const { hasPermission } = require('../middleware/auth');
    if (!hasPermission(req.user, 'check_in')) warnings.push('Guest was not checked in: your account lacks the check-in permission.');
    else {
      try { await checkIn(req, booking.id, { override_housekeeping: false }); } catch (err) { warnings.push(`Guest was not checked in: ${err.message}`); }
    }
  }
  return { booking: await getById(req.user, booking.id), warnings };
}

// ───────────────────────────── Jobs ─────────────────────────────

/** Expire unpaid online holds whose time has run out, releasing their rooms and coupon usage. */
async function expireHolds(now = new Date()) {
  const due = await prisma.booking.findMany({ where: { bookingStatus: 'PENDING_PAYMENT', expiresAt: { lte: now } }, select: { id: true } });
  let expired = 0;
  for (const { id } of due) {
    const done = await prisma.$transaction(async (tx) => {
      const res = await tx.booking.updateMany({ where: { id, bookingStatus: 'PENDING_PAYMENT', expiresAt: { lte: now } }, data: { bookingStatus: 'EXPIRED' } });
      if (!res.count) return false; // paid/cancelled meanwhile
      const b = await tx.booking.findUnique({ where: { id } });
      if (b.couponId) await tx.coupon.updateMany({ where: { id: b.couponId, usedCount: { gt: 0 } }, data: { usedCount: { decrement: 1 } } });
      await tx.payment.updateMany({ where: { bookingId: id, paymentStatus: 'PENDING' }, data: { paymentStatus: 'FAILED', failureReason: 'Checkout expired' } });
      return true;
    }, TX_OPTS);
    if (done) {
      expired++;
      const b = await prisma.booking.findUnique({ where: { id } });
      await notifications.notify(b.userId, { title: 'Reservation hold expired', message: `We didn't receive payment for ${b.bookingReference} in time, so the rooms were released.`, type: 'BOOKING', bookingId: id });
      await email.send('bookingExpired', b.guestEmail, { booking: b }, b.guestFirstName);
      await audit.log(null, 'BOOKING_EXPIRED', { entityType: 'booking', entityId: id, description: b.bookingReference });
    }
  }
  return expired;
}

/** Email + in-app reminder the day before arrival (sent once per booking). */
async function sendCheckInReminders() {
  const tomorrow = addDays(hotelToday(), 1);
  const settings = await hotel.getSettings();
  const rows = await prisma.booking.findMany({ where: { checkIn: tomorrow, bookingStatus: 'CONFIRMED', reminderSentAt: null }, include });
  for (const b of rows) {
    const claimed = await prisma.booking.updateMany({ where: { id: b.id, reminderSentAt: null }, data: { reminderSentAt: new Date() } });
    if (!claimed.count) continue;
    await email.send('checkInReminder', b.guestEmail, { booking: b, settings }, b.guestFirstName);
    await notifications.notify(b.userId, { title: 'Your stay begins tomorrow', message: `Check-in for ${b.bookingReference} starts at ${settings.checkInTime}.`, type: 'REMINDER', bookingId: b.id });
  }
  return rows.length;
}

module.exports = {
  include, present, create, getById, getRaw, listMine, listAdmin, adminWhere, cancelByCustomer, adminSetStatus, reviewCancellation,
  checkIn, checkOut, assignRoom, assignableRooms, arrivals, departures, inHouse, walkIn, expireHolds, sendCheckInReminders,
  derivePaymentStatus, withRetry, afterStatusChange, assertCanView, TX_OPTS,
};
