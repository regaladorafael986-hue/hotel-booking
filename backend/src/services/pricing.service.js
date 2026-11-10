/**
 * Server-side price calculation. The frontend only ever *displays* these numbers;
 * any amount sent by a client is ignored and recomputed here.
 */
const prisma = require('../config/prisma');
const AppError = require('../utils/AppError');
const { toCents, fromCents, pesoCents } = require('../utils/money');
const { parseDate, hotelToday, nightsBetween, addDays, formatDate } = require('../utils/dates');

const MAX_NIGHTS = 30;
const MAX_ADVANCE_DAYS = 365;

/** Validate and normalise the stay dates. */
function validateStay(checkInStr, checkOutStr, { allowPast = false } = {}) {
  const checkIn = parseDate(checkInStr, 'Check-in date');
  const checkOut = parseDate(checkOutStr, 'Check-out date');
  const today = hotelToday();
  if (!allowPast && checkIn < today) throw AppError.badRequest('Check-in date cannot be in the past.', { fields: { check_in: 'Choose today or a later date.' } });
  if (checkOut <= checkIn) throw AppError.badRequest('Check-out must be after check-in.', { fields: { check_out: 'Must be after check-in.' } });
  const nights = nightsBetween(checkIn, checkOut);
  if (nights > MAX_NIGHTS) throw AppError.badRequest(`Stays are limited to ${MAX_NIGHTS} nights per booking.`, { fields: { check_out: `Max ${MAX_NIGHTS} nights.` } });
  if (checkIn > addDays(today, MAX_ADVANCE_DAYS)) throw AppError.badRequest('Reservations can be made up to one year in advance.');
  return { checkIn, checkOut, nights };
}

/** Check room count and guest capacity across the selected categories. */
function validateCapacity(lines, adults, children) {
  const totalRooms = lines.reduce((s, l) => s + l.quantity, 0);
  const maxAdults = lines.reduce((s, l) => s + l.roomType.maxAdults * l.quantity, 0);
  const maxGuests = lines.reduce((s, l) => s + (l.roomType.maxAdults + l.roomType.maxChildren) * l.quantity, 0);
  if (totalRooms > adults) throw AppError.badRequest('Each room needs at least one adult.', { fields: { adults: 'At least one adult per room.' } });
  if (adults > maxAdults) throw AppError.badRequest(`The selected room(s) fit at most ${maxAdults} adult(s). Add another room or choose a larger category.`);
  if (adults + children > maxGuests) throw AppError.badRequest(`The selected room(s) fit at most ${maxGuests} guest(s) in total. Add another room or choose a larger category.`);
  return totalRooms;
}

/** Split guests across the physical rooms as evenly as each room's capacity allows. */
function distributeGuests(units, adults, children) {
  const out = units.map(() => ({ adults: 0, children: 0 }));
  let a = adults;
  let c = children;
  units.forEach((u, i) => { out[i].adults = 1; a -= 1; });
  for (let pass = 0; a > 0 && pass < 50; pass++) units.forEach((u, i) => { if (a > 0 && out[i].adults < u.maxAdults) { out[i].adults++; a--; } });
  for (let pass = 0; c > 0 && pass < 50; pass++) {
    units.forEach((u, i) => {
      const spare = u.maxAdults + u.maxChildren - out[i].adults - out[i].children;
      if (c > 0 && spare > 0) { out[i].children++; c--; }
    });
  }
  return out;
}

/**
 * Evaluate a coupon against a subtotal. Throws a user-friendly error when it does not apply.
 * @returns {{ coupon, discountCents }}
 */
async function evaluateCoupon(code, subtotalCents, client = prisma) {
  if (!code) return { coupon: null, discountCents: 0 };
  const coupon = await client.coupon.findUnique({ where: { code: code.toUpperCase() } });
  const today = hotelToday();
  const fail = (msg) => { throw AppError.badRequest(msg, { fields: { coupon_code: msg } }); };
  if (!coupon || coupon.status !== 'ACTIVE') fail('This promo code is not valid.');
  if (today < coupon.startDate) fail(`This promo code becomes valid on ${formatDate(coupon.startDate)}.`);
  if (today > coupon.endDate) fail('This promo code has expired.');
  if (coupon.usageLimit !== null && coupon.usedCount >= coupon.usageLimit) fail('This promo code has reached its usage limit.');
  const minCents = toCents(coupon.minimumAmount);
  if (subtotalCents < minCents) fail(`This promo code requires a minimum booking of ${pesoCents(minCents)}.`);
  let discountCents = coupon.discountType === 'PERCENTAGE'
    ? Math.round((subtotalCents * Number(coupon.discountValue)) / 100)
    : toCents(coupon.discountValue);
  if (coupon.maximumDiscount !== null) discountCents = Math.min(discountCents, toCents(coupon.maximumDiscount));
  discountCents = Math.min(discountCents, subtotalCents);
  return { coupon, discountCents };
}

/**
 * Build a full price quote from trusted DB prices.
 * @param {object} p { check_in, check_out, adults, children, items:[{room_type_id, quantity}], coupon_code }
 */
async function quote(p, { client = prisma, settings, allowPast = false } = {}) {
  const { checkIn, checkOut, nights } = validateStay(p.check_in, p.check_out, { allowPast });
  const merged = new Map();
  for (const it of p.items) merged.set(it.room_type_id, (merged.get(it.room_type_id) || 0) + it.quantity);
  const types = await client.roomType.findMany({ where: { id: { in: [...merged.keys()] } } });
  const lines = [...merged.entries()].map(([id, quantity]) => {
    const roomType = types.find((t) => t.id === id);
    if (!roomType || roomType.status !== 'ACTIVE') throw AppError.badRequest('One of the selected rooms is no longer available for booking.');
    return { roomType, quantity };
  });
  const totalRooms = validateCapacity(lines, p.adults, p.children || 0);

  const s = settings || (await client.hotelSettings.findFirst({ orderBy: { id: 'asc' } }));
  const taxRate = Number(s?.taxRate ?? 0);
  let subtotalCents = 0;
  const lineItems = lines.map((l) => {
    const rateCents = toCents(l.roomType.basePrice);
    const amountCents = rateCents * nights * l.quantity;
    subtotalCents += amountCents;
    return { room_type_id: l.roomType.id, name: l.roomType.name, quantity: l.quantity, nightly_rate: Number(fromCents(rateCents)), nights, amount: Number(fromCents(amountCents)), _rateCents: rateCents, _roomType: l.roomType };
  });
  const { coupon, discountCents } = await evaluateCoupon(p.coupon_code, subtotalCents, client);
  const taxableCents = subtotalCents - discountCents;
  const taxCents = Math.round((taxableCents * taxRate) / 100);
  const totalCents = taxableCents + taxCents;

  return {
    checkIn, checkOut, nights, totalRooms, coupon, lines: lineItems,
    amounts: { subtotal: fromCents(subtotalCents), discount: fromCents(discountCents), taxes: fromCents(taxCents), total: fromCents(totalCents) },
    public: {
      check_in: formatDate(checkIn), check_out: formatDate(checkOut), nights, total_rooms: totalRooms, adults: p.adults, children: p.children || 0,
      lines: lineItems.map(({ _rateCents, _roomType, ...rest }) => rest),
      coupon: coupon ? { code: coupon.code, description: coupon.description } : null,
      tax_rate: taxRate,
      subtotal: Number(fromCents(subtotalCents)), discount: Number(fromCents(discountCents)), taxes: Number(fromCents(taxCents)), total: Number(fromCents(totalCents)),
    },
  };
}

module.exports = { quote, validateStay, validateCapacity, distributeGuests, evaluateCoupon, MAX_NIGHTS };
