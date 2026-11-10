// Customer & staff account management (admin side).
const prisma = require('../config/prisma');
const AppError = require('../utils/AppError');
const { serialize } = require('../utils/serialize');
const { getPagination, paged } = require('../utils/pagination');
const { store } = require('../utils/sessionStore');
const { toPublicUser, hashPassword } = require('./auth.service');
const audit = require('./audit.service');

const searchWhere = (q) => (q ? { OR: [{ firstName: { contains: q } }, { lastName: { contains: q } }, { email: { contains: q } }, { phone: { contains: q } }] } : {});

async function listCustomers(q = {}) {
  const where = { role: 'CUSTOMER', ...searchWhere(q.q), ...(q.status ? { accountStatus: q.status } : {}) };
  const pg = getPagination(q);
  const [rows, total] = await Promise.all([
    prisma.user.findMany({ where, orderBy: { createdAt: 'desc' }, skip: pg.skip, take: pg.take, include: { _count: { select: { bookings: true } } } }),
    prisma.user.count({ where }),
  ]);
  const ids = rows.map((r) => r.id);
  const spend = ids.length ? await prisma.booking.groupBy({ by: ['userId'], where: { userId: { in: ids } }, _sum: { amountPaid: true, amountRefunded: true } }) : [];
  const spendMap = new Map(spend.map((s) => [s.userId, Number(s._sum.amountPaid || 0) - Number(s._sum.amountRefunded || 0)]));
  return paged(rows.map((u) => ({ ...toPublicUser(u), last_login_at: u.lastLoginAt, booking_count: u._count.bookings, total_spent: Number((spendMap.get(u.id) || 0).toFixed(2)) })), total, pg);
}

async function getCustomer(id) {
  const u = await prisma.user.findUnique({
    where: { id },
    include: {
      bookings: { orderBy: { createdAt: 'desc' }, include: { rooms: { include: { roomType: { select: { name: true } } } } } },
      reviews: { orderBy: { createdAt: 'desc' } },
    },
  });
  if (!u || u.role !== 'CUSTOMER') throw AppError.notFound('Customer not found.');
  const payments = await prisma.payment.findMany({ where: { booking: { userId: id } }, include: { booking: { select: { bookingReference: true } }, refunds: true }, orderBy: { createdAt: 'desc' } });
  return { ...toPublicUser(u), last_login_at: u.lastLoginAt, bookings: serialize(u.bookings), payments: serialize(payments), reviews: serialize(u.reviews) };
}

async function setStatus(req, id, status, { role } = {}) {
  if (id === req.user.id) throw AppError.badRequest('You cannot change the status of your own account.');
  const u = await prisma.user.findUnique({ where: { id } });
  if (!u || (role && u.role !== role)) throw AppError.notFound('Account not found.');
  if (u.role === 'ADMIN') throw AppError.forbidden('Administrator accounts cannot be changed here.');
  await prisma.user.update({ where: { id }, data: { accountStatus: status } });
  if (status === 'INACTIVE') await store.destroyUserSessions(id);
  await audit.log(req, status === 'ACTIVE' ? 'ACCOUNT_ACTIVATED' : 'ACCOUNT_DEACTIVATED', { entityType: 'user', entityId: id, description: `${u.email} (${u.role})` });
  return toPublicUser({ ...u, accountStatus: status });
}

async function listStaff(q = {}) {
  const where = { role: { in: ['RECEPTIONIST', 'ADMIN'] }, ...searchWhere(q.q), ...(q.role ? { role: q.role } : {}), ...(q.status ? { accountStatus: q.status } : {}) };
  const rows = await prisma.user.findMany({ where, orderBy: [{ role: 'asc' }, { lastName: 'asc' }] });
  return rows.map((u) => ({ ...toPublicUser(u), last_login_at: u.lastLoginAt }));
}

async function createStaff(req, d) {
  const email = d.email.toLowerCase();
  if (await prisma.user.findUnique({ where: { email } })) throw AppError.conflict('An account with this email already exists.', { fields: { email: 'Already registered.' } });
  const u = await prisma.user.create({
    data: { firstName: d.first_name, lastName: d.last_name, email, phone: d.phone || null, passwordHash: await hashPassword(d.password), role: 'RECEPTIONIST', permissions: d.permissions ?? undefined, emailVerifiedAt: new Date() },
  });
  await audit.log(req, 'STAFF_CREATED', { entityType: 'user', entityId: u.id, description: `${u.email} permissions: ${(d.permissions || ['default']).join(', ')}` });
  return toPublicUser(u);
}

async function updateStaff(req, id, d) {
  const u = await prisma.user.findUnique({ where: { id } });
  if (!u || u.role !== 'RECEPTIONIST') throw AppError.notFound('Staff account not found.');
  if (d.account_status && id === req.user.id) throw AppError.badRequest('You cannot change the status of your own account.');
  const data = {
    firstName: d.first_name ?? undefined,
    lastName: d.last_name ?? undefined,
    phone: d.phone === '' ? null : d.phone ?? undefined,
    permissions: d.permissions ?? undefined,
    accountStatus: d.account_status ?? undefined,
    ...(d.password ? { passwordHash: await hashPassword(d.password) } : {}),
  };
  const updated = await prisma.user.update({ where: { id }, data });
  if (d.account_status === 'INACTIVE' || d.password) await store.destroyUserSessions(id);
  await audit.log(req, 'STAFF_UPDATED', { entityType: 'user', entityId: id, description: `${u.email}: ${Object.keys(d).filter((k) => k !== 'password' || d.password).join(', ')}` });
  return toPublicUser(updated);
}

/** Lookup for front-desk walk-ins: find an existing customer by email/name/phone. */
async function searchCustomersLite(q) {
  if (!q || q.length < 2) return [];
  const rows = await prisma.user.findMany({ where: { role: 'CUSTOMER', accountStatus: 'ACTIVE', ...searchWhere(q) }, take: 8, orderBy: { lastName: 'asc' } });
  return rows.map((u) => ({ id: u.id, first_name: u.firstName, last_name: u.lastName, email: u.email, phone: u.phone }));
}

module.exports = { listCustomers, getCustomer, setStatus, listStaff, createStaff, updateStaff, searchCustomersLite };
