const bcrypt = require('bcryptjs');
const prisma = require('../config/prisma');
const env = require('../config/env');
const AppError = require('../utils/AppError');
const { randomToken, sha256 } = require('../utils/crypto');
const email = require('./email.service');
const audit = require('./audit.service');
const { DEFAULT_STAFF_PERMISSIONS } = require('../middleware/auth');
const { store } = require('../utils/sessionStore');

const BCRYPT_ROUNDS = 12;
const VERIFY_TTL = 24 * 60 * 60 * 1000;
const RESET_TTL = 60 * 60 * 1000;
// A real hash compared against when the email doesn't exist, so login timing doesn't reveal which emails are registered.
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 10);

const hashPassword = (pw) => bcrypt.hash(pw, BCRYPT_ROUNDS);

function toPublicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    first_name: u.firstName,
    last_name: u.lastName,
    email: u.email,
    phone: u.phone,
    role: u.role,
    account_status: u.accountStatus,
    email_verified: Boolean(u.emailVerifiedAt),
    has_password: Boolean(u.passwordHash),
    permissions: u.role === 'RECEPTIONIST' ? (Array.isArray(u.permissions) ? u.permissions : DEFAULT_STAFF_PERMISSIONS) : u.role === 'ADMIN' ? DEFAULT_STAFF_PERMISSIONS : [],
    created_at: u.createdAt,
  };
}

async function issueToken(userId, type, ttl) {
  // Invalidate earlier unused tokens of the same type.
  await prisma.authToken.updateMany({ where: { userId, type, usedAt: null }, data: { usedAt: new Date() } });
  const token = randomToken(32);
  await prisma.authToken.create({ data: { userId, type, tokenHash: sha256(token), expiresAt: new Date(Date.now() + ttl) } });
  return token;
}

async function consumeToken(token, type) {
  if (!token || typeof token !== 'string') throw AppError.badRequest('Invalid or expired link.');
  const row = await prisma.authToken.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  if (!row || row.type !== type || row.usedAt || row.expiresAt < new Date()) throw AppError.badRequest('This link is invalid or has expired. Please request a new one.');
  await prisma.authToken.update({ where: { id: row.id }, data: { usedAt: new Date() } });
  return row.user;
}

async function sendVerification(user) {
  const token = await issueToken(user.id, 'EMAIL_VERIFICATION', VERIFY_TTL);
  await email.send('verifyEmail', user.email, { user, url: `${env.appUrl}/verify-email.html?token=${token}` }, user.firstName);
}

async function register(req, data) {
  const emailAddr = data.email.toLowerCase();
  const exists = await prisma.user.findUnique({ where: { email: emailAddr } });
  if (exists) throw AppError.conflict('An account with this email already exists. Try logging in instead.');
  const user = await prisma.user.create({
    data: { firstName: data.first_name, lastName: data.last_name, email: emailAddr, phone: data.phone || null, passwordHash: await hashPassword(data.password), role: 'CUSTOMER' },
  });
  await sendVerification(user);
  await audit.log({ ...req, user }, 'USER_REGISTERED', { entityType: 'user', entityId: user.id });
  return user;
}

async function login(req, { email: emailAddr, password }) {
  const user = await prisma.user.findUnique({ where: { email: emailAddr.toLowerCase() } });
  // Social-login-only accounts have no password: compare against a dummy hash so they fail the same way (and take the same time).
  const ok = await bcrypt.compare(password, user?.passwordHash || DUMMY_HASH) && Boolean(user?.passwordHash);
  if (!user || !ok) {
    await audit.log(req, 'LOGIN_FAILED', { entityType: 'user', description: `Failed login for ${emailAddr.toLowerCase()}` });
    throw AppError.unauthorized('Incorrect email or password.');
  }
  if (user.accountStatus !== 'ACTIVE') throw AppError.forbidden('This account has been deactivated. Please contact the hotel.');
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  if (user.role !== 'CUSTOMER') await audit.log({ ...req, user }, 'STAFF_LOGIN', { entityType: 'user', entityId: user.id });
  return user;
}

async function verifyEmail(token) {
  const user = await consumeToken(token, 'EMAIL_VERIFICATION');
  if (!user.emailVerifiedAt) await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
  return user;
}

async function resendVerification(user) {
  if (user.emailVerifiedAt) throw AppError.badRequest('Your email is already verified.');
  await sendVerification(user);
}

/** Always resolves the same way whether or not the email exists (prevents account enumeration). */
async function forgotPassword(emailAddr) {
  const user = await prisma.user.findUnique({ where: { email: emailAddr.toLowerCase() } });
  if (!user || user.accountStatus !== 'ACTIVE') return;
  const token = await issueToken(user.id, 'PASSWORD_RESET', RESET_TTL);
  await email.send('passwordReset', user.email, { user, url: `${env.appUrl}/reset-password.html?token=${token}` }, user.firstName);
}

async function resetPassword(req, token, password) {
  const user = await consumeToken(token, 'PASSWORD_RESET');
  // Completing a reset proves control of the inbox, so the email counts as verified too.
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(password), emailVerifiedAt: user.emailVerifiedAt || new Date() } });
  await store.destroyUserSessions(user.id);
  await audit.log({ ...req, user }, 'PASSWORD_RESET', { entityType: 'user', entityId: user.id });
}

async function updateProfile(user, data) {
  return prisma.user.update({
    where: { id: user.id },
    data: { firstName: data.first_name ?? undefined, lastName: data.last_name ?? undefined, phone: data.phone === '' ? null : data.phone ?? undefined },
  });
}

async function changePassword(req, { current_password, new_password }) {
  // Accounts created with Google/Facebook have no password yet: they may set one without a current password.
  if (req.user.passwordHash) {
    const ok = await bcrypt.compare(current_password || '', req.user.passwordHash);
    if (!ok) throw AppError.badRequest('Your current password is incorrect.', { fields: { current_password: 'Incorrect password.' } });
  }
  await prisma.user.update({ where: { id: req.user.id }, data: { passwordHash: await hashPassword(new_password) } });
  await store.destroyUserSessions(req.user.id, req.sessionID);
  await audit.log(req, 'PASSWORD_CHANGED', { entityType: 'user', entityId: req.user.id });
}

module.exports = { register, login, verifyEmail, resendVerification, forgotPassword, resetPassword, updateProfile, changePassword, toPublicUser, hashPassword };
