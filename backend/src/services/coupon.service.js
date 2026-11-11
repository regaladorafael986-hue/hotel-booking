const prisma = require('../config/prisma');
const AppError = require('../utils/AppError');
const { serialize } = require('../utils/serialize');
const { parseDate, hotelToday } = require('../utils/dates');
const { getPagination, paged } = require('../utils/pagination');
const audit = require('./audit.service');

function toData(d) {
  const out = {};
  if (d.code !== undefined) out.code = d.code.toUpperCase();
  if (d.description !== undefined) out.description = d.description || null;
  if (d.discount_type !== undefined) out.discountType = d.discount_type;
  if (d.discount_value !== undefined) out.discountValue = String(d.discount_value);
  if (d.minimum_amount !== undefined) out.minimumAmount = String(d.minimum_amount);
  if (d.maximum_discount !== undefined) out.maximumDiscount = d.maximum_discount === null ? null : String(d.maximum_discount);
  if (d.usage_limit !== undefined) out.usageLimit = d.usage_limit;
  if (d.start_date !== undefined) out.startDate = parseDate(d.start_date, 'Start date');
  if (d.end_date !== undefined) out.endDate = parseDate(d.end_date, 'End date');
  if (d.is_featured !== undefined) out.isFeatured = d.is_featured;
  if (d.status !== undefined) out.status = d.status;
  return out;
}

function withState(c) {
  const s = serialize(c);
  const today = hotelToday();
  s.state = c.status !== 'ACTIVE' ? 'INACTIVE' : today < c.startDate ? 'SCHEDULED' : today > c.endDate ? 'EXPIRED' : c.usageLimit !== null && c.usedCount >= c.usageLimit ? 'USED_UP' : 'LIVE';
  return s;
}

async function list(q = {}) {
  const where = {};
  if (q.q) where.OR = [{ code: { contains: q.q, mode: 'insensitive' } }, { description: { contains: q.q, mode: 'insensitive' } }];
  if (q.status) where.status = q.status;
  const pg = getPagination(q);
  const [rows, total] = await Promise.all([prisma.coupon.findMany({ where, orderBy: { createdAt: 'desc' }, skip: pg.skip, take: pg.take }), prisma.coupon.count({ where })]);
  return paged(rows.map(withState), total, pg);
}

async function create(req, d) {
  const c = await prisma.coupon.create({ data: toData(d) });
  await audit.log(req, 'COUPON_CREATED', { entityType: 'coupon', entityId: c.id, description: c.code });
  return withState(c);
}

async function update(req, id, d) {
  const before = await prisma.coupon.findUnique({ where: { id } });
  if (!before) throw AppError.notFound('Coupon not found.');
  const merged = { start: d.start_date ?? before.startDate.toISOString().slice(0, 10), end: d.end_date ?? before.endDate.toISOString().slice(0, 10) };
  if (merged.end < merged.start) throw AppError.badRequest('End date must be on or after the start date.', { fields: { end_date: 'Must be after start date.' } });
  const type = d.discount_type ?? before.discountType;
  const value = d.discount_value ?? Number(before.discountValue);
  if (type === 'PERCENTAGE' && value > 100) throw AppError.badRequest('Percentage discount cannot exceed 100%.', { fields: { discount_value: 'Max 100%.' } });
  const c = await prisma.coupon.update({ where: { id }, data: toData(d) });
  await audit.log(req, 'COUPON_UPDATED', { entityType: 'coupon', entityId: id, description: `${c.code}: ${Object.keys(d).join(', ')}` });
  return withState(c);
}

async function remove(req, id) {
  const c = await prisma.coupon.findUnique({ where: { id }, include: { _count: { select: { bookings: true } } } });
  if (!c) throw AppError.notFound('Coupon not found.');
  if (c._count.bookings > 0) {
    await prisma.coupon.update({ where: { id }, data: { status: 'INACTIVE' } });
    await audit.log(req, 'COUPON_DEACTIVATED', { entityType: 'coupon', entityId: id, description: `${c.code} (used by bookings; deactivated instead of deleted)` });
    return { deactivated: true };
  }
  await prisma.coupon.delete({ where: { id } });
  await audit.log(req, 'COUPON_DELETED', { entityType: 'coupon', entityId: id, description: c.code });
  return { deleted: true };
}

/** Public "special offers": featured coupons that are live today. */
async function publicOffers() {
  const today = hotelToday();
  const rows = await prisma.coupon.findMany({ where: { status: 'ACTIVE', isFeatured: true, startDate: { lte: today }, endDate: { gte: today } }, orderBy: { endDate: 'asc' }, take: 6 });
  return rows.filter((c) => c.usageLimit === null || c.usedCount < c.usageLimit).map((c) => ({
    code: c.code, description: c.description, discount_type: c.discountType, discount_value: Number(c.discountValue),
    minimum_amount: Number(c.minimumAmount), maximum_discount: c.maximumDiscount === null ? null : Number(c.maximumDiscount), end_date: c.endDate.toISOString().slice(0, 10),
  }));
}

module.exports = { list, create, update, remove, publicOffers };
