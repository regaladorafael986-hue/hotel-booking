const prisma = require('../config/prisma');
const AppError = require('../utils/AppError');
const { serialize } = require('../utils/serialize');
const { getPagination, paged } = require('../utils/pagination');
const audit = require('./audit.service');
const notifications = require('./notification.service');

const publicShape = (r) => ({
  id: r.id, rating: r.rating, title: r.title, comment: r.comment, created_at: r.createdAt,
  guest_name: `${r.user.firstName} ${r.user.lastName.charAt(0)}.`,
  room_types: [...new Set((r.booking?.rooms || []).map((br) => br.roomType.name))],
  stay_month: r.booking ? r.booking.checkIn.toISOString().slice(0, 7) : null,
});

async function create(req, d) {
  const booking = await prisma.booking.findUnique({ where: { id: d.booking_id }, include: { review: true } });
  if (!booking || booking.userId !== req.user.id) throw AppError.notFound('Booking not found.');
  if (booking.bookingStatus !== 'CHECKED_OUT') throw AppError.conflict('You can review a stay after you have checked out.');
  if (booking.review) throw AppError.conflict('You have already reviewed this stay.');
  const review = await prisma.review.create({ data: { bookingId: booking.id, userId: req.user.id, rating: d.rating, title: d.title || null, comment: d.comment || null, status: 'PENDING' } });
  await notifications.notifyAdmins({ title: 'New review to moderate', message: `${d.rating}★ review for ${booking.bookingReference}.`, type: 'SYSTEM', bookingId: booking.id });
  return serialize(review);
}

async function listPublic(q = {}) {
  const take = Math.min(24, Math.max(1, parseInt(q.limit, 10) || 6));
  const [rows, agg] = await Promise.all([
    prisma.review.findMany({ where: { status: 'APPROVED' }, include: { user: { select: { firstName: true, lastName: true } }, booking: { select: { checkIn: true, rooms: { select: { roomType: { select: { name: true } } } } } } }, orderBy: [{ rating: 'desc' }, { createdAt: 'desc' }], take }),
    prisma.review.aggregate({ where: { status: 'APPROVED' }, _avg: { rating: true }, _count: true }),
  ]);
  return { items: rows.map(publicShape), average: agg._avg.rating ? Number(agg._avg.rating.toFixed(1)) : null, count: agg._count };
}

async function listMine(user) {
  const rows = await prisma.review.findMany({ where: { userId: user.id }, include: { booking: { select: { id: true, bookingReference: true, checkIn: true, checkOut: true } } }, orderBy: { createdAt: 'desc' } });
  return serialize(rows);
}

async function listAdmin(q = {}) {
  const where = {};
  if (q.status) where.status = q.status;
  if (q.q) where.OR = [{ comment: { contains: q.q, mode: 'insensitive' } }, { title: { contains: q.q, mode: 'insensitive' } }, { booking: { bookingReference: { contains: q.q, mode: 'insensitive' } } }, { user: { lastName: { contains: q.q, mode: 'insensitive' } } }];
  const pg = getPagination(q);
  const [rows, total] = await Promise.all([
    prisma.review.findMany({ where, include: { user: { select: { id: true, firstName: true, lastName: true, email: true } }, booking: { select: { id: true, bookingReference: true, checkIn: true, checkOut: true } } }, orderBy: { createdAt: 'desc' }, skip: pg.skip, take: pg.take }),
    prisma.review.count({ where }),
  ]);
  return paged(serialize(rows), total, pg);
}

async function moderate(req, id, status) {
  const r = await prisma.review.findUnique({ where: { id } });
  if (!r) throw AppError.notFound('Review not found.');
  const updated = await prisma.review.update({ where: { id }, data: { status } });
  await audit.log(req, 'REVIEW_MODERATED', { entityType: 'review', entityId: id, description: `${r.status} → ${status}` });
  return serialize(updated);
}

async function remove(req, id) {
  const r = await prisma.review.findUnique({ where: { id } });
  if (!r) throw AppError.notFound('Review not found.');
  await prisma.review.delete({ where: { id } });
  await audit.log(req, 'REVIEW_DELETED', { entityType: 'review', entityId: id });
}

module.exports = { create, listPublic, listMine, listAdmin, moderate, remove };
