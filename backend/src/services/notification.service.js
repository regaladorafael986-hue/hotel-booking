const prisma = require('../config/prisma');
const AppError = require('../utils/AppError');
const { getPagination, paged } = require('../utils/pagination');
const { serialize } = require('../utils/serialize');

/** Create an in-app notification. No-op for bookings without an account (walk-ins). */
async function notify(userId, { title, message, type = 'SYSTEM', bookingId = null }, client = prisma) {
  if (!userId) return null;
  try {
    return await client.notification.create({ data: { userId, title, message, type, bookingId } });
  } catch (err) {
    console.error('[notify] failed', err.message);
    return null;
  }
}

/** Notify every active administrator (e.g. a new cancellation request). */
async function notifyAdmins({ title, message, type = 'SYSTEM', bookingId = null }) {
  const admins = await prisma.user.findMany({ where: { role: 'ADMIN', accountStatus: 'ACTIVE' }, select: { id: true } });
  if (!admins.length) return;
  await prisma.notification.createMany({ data: admins.map((a) => ({ userId: a.id, title, message, type, bookingId })) });
}

async function listForUser(userId, query) {
  const pg = getPagination(query, { defaultSize: 15 });
  const where = { userId, ...(query.unread === 'true' ? { isRead: false } : {}) };
  const [items, total, unread] = await Promise.all([
    prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, skip: pg.skip, take: pg.take }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { userId, isRead: false } }),
  ]);
  return { ...paged(serialize(items), total, pg), unread };
}

async function markRead(userId, id) {
  const n = await prisma.notification.findFirst({ where: { id, userId } });
  if (!n) throw AppError.notFound('Notification not found.');
  await prisma.notification.update({ where: { id }, data: { isRead: true } });
}

const markAllRead = (userId) => prisma.notification.updateMany({ where: { userId, isRead: false }, data: { isRead: true } });

module.exports = { notify, notifyAdmins, listForUser, markRead, markAllRead };
