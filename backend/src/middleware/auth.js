const prisma = require('../config/prisma');
const AppError = require('../utils/AppError');

/** Receptionist permission keys. Administrators implicitly have all of them. */
const STAFF_PERMISSIONS = {
  check_in: 'Check guests in',
  check_out: 'Check guests out',
  assign_room: 'Assign / reassign physical rooms',
  collect_payment: 'Record payments collected at the hotel',
  walk_in: 'Create walk-in reservations',
  housekeeping: 'Update housekeeping status',
  view_customers: 'View customer profiles',
};
const DEFAULT_STAFF_PERMISSIONS = Object.keys(STAFF_PERMISSIONS);

/** Loads the logged-in user (if any) onto req.user. Inactive accounts are logged out immediately. */
async function loadUser(req, res, next) {
  const userId = req.session?.userId;
  if (!userId) return next();
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.accountStatus !== 'ACTIVE') {
    delete req.session.userId;
    return next();
  }
  req.user = user;
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return next(AppError.unauthorized());
  next();
}

const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) return next(AppError.unauthorized());
  if (!roles.includes(req.user.role)) return next(AppError.forbidden());
  next();
};

function hasPermission(user, perm) {
  if (!user) return false;
  if (user.role === 'ADMIN') return true;
  if (user.role !== 'RECEPTIONIST') return false;
  const perms = Array.isArray(user.permissions) ? user.permissions : DEFAULT_STAFF_PERMISSIONS;
  return perms.includes(perm);
}

const requirePermission = (perm) => (req, res, next) => {
  if (!req.user) return next(AppError.unauthorized());
  if (!hasPermission(req.user, perm)) return next(AppError.forbidden(`Your account is missing the "${STAFF_PERMISSIONS[perm] || perm}" permission.`));
  next();
};

module.exports = { loadUser, requireAuth, requireRole, requirePermission, hasPermission, STAFF_PERMISSIONS, DEFAULT_STAFF_PERMISSIONS };
