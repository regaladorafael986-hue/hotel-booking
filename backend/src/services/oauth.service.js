/**
 * Social sign-in (OAuth 2.0 authorization-code flow, server side).
 *
 * Security:
 *  - `state` (random, single-use, 10-minute lifetime, stored in the server session) blocks CSRF / login forgery.
 *  - PKCE (S256) for Google; Facebook requests are signed with `appsecret_proof`.
 *  - Client secrets never leave the server; tokens are used once to read the profile and then discarded.
 *  - An existing StayEase account is linked by email ONLY when the provider says that email is verified
 *    (Google `email_verified`). Otherwise the user must log in with their password and connect from their profile.
 *  - Social sign-in is for customer accounts; staff/admin accounts must use email + password.
 *
 * Not live until GOOGLE_CLIENT_ID/SECRET and/or FACEBOOK_APP_ID/SECRET are configured.
 */
const crypto = require('crypto');
const prisma = require('../config/prisma');
const env = require('../config/env');
const AppError = require('../utils/AppError');
const { randomToken, safeEqual, hmacSha256 } = require('../utils/crypto');
const audit = require('./audit.service');

const STATE_TTL_MS = 10 * 60 * 1000;
const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function http(url, opts = {}) {
  const res = await fetch(url, { ...opts, headers: { accept: 'application/json', ...(opts.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error('[oauth]', url.split('?')[0], res.status, JSON.stringify(data).slice(0, 300));
    throw new AppError(502, 'The sign-in provider did not accept the request. Please try again.', { code: 'OAUTH_PROVIDER' });
  }
  return data;
}

const PROVIDERS = {
  google: {
    name: 'Google',
    configured: () => Boolean(env.oauth.google.clientId && env.oauth.google.clientSecret),
    pkce: true,
    authorizeUrl({ state, challenge, redirectUri }) {
      const q = new URLSearchParams({
        client_id: env.oauth.google.clientId, redirect_uri: redirectUri, response_type: 'code', scope: 'openid email profile',
        state, code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account',
      });
      return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
    },
    async profile({ code, verifier, redirectUri }) {
      const token = await http('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ code, client_id: env.oauth.google.clientId, client_secret: env.oauth.google.clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code', code_verifier: verifier }),
      });
      const u = await http('https://openidconnect.googleapis.com/v1/userinfo', { headers: { authorization: `Bearer ${token.access_token}` } });
      return { id: String(u.sub), email: u.email || null, emailVerified: u.email_verified === true, firstName: u.given_name || u.name || 'Guest', lastName: u.family_name || '' };
    },
  },
  facebook: {
    name: 'Facebook',
    configured: () => Boolean(env.oauth.facebook.clientId && env.oauth.facebook.clientSecret),
    pkce: false,
    authorizeUrl({ state, redirectUri }) {
      const q = new URLSearchParams({ client_id: env.oauth.facebook.clientId, redirect_uri: redirectUri, state, response_type: 'code', scope: 'email,public_profile' });
      return `https://www.facebook.com/${env.oauth.facebook.graphVersion}/dialog/oauth?${q}`;
    },
    async profile({ code, redirectUri }) {
      const v = env.oauth.facebook.graphVersion;
      const token = await http(`https://graph.facebook.com/${v}/oauth/access_token?${new URLSearchParams({ client_id: env.oauth.facebook.clientId, client_secret: env.oauth.facebook.clientSecret, redirect_uri: redirectUri, code })}`);
      const proof = hmacSha256(env.oauth.facebook.clientSecret, token.access_token);
      const u = await http(`https://graph.facebook.com/${v}/me?${new URLSearchParams({ fields: 'id,first_name,last_name,email', access_token: token.access_token, appsecret_proof: proof })}`);
      // Facebook does not state that the returned email is verified, so we never link existing accounts on it.
      return { id: String(u.id), email: u.email || null, emailVerified: false, firstName: u.first_name || 'Guest', lastName: u.last_name || '' };
    },
  },
};

const redirectUriFor = (provider) => `${env.appUrl}/api/v1/auth/oauth/${provider}/callback`;

function getProvider(key) {
  const p = PROVIDERS[key];
  if (!p) throw AppError.notFound('Unknown sign-in provider.');
  if (!p.configured()) throw new AppError(503, `${p.name} sign-in is not set up yet. Please use email and password.`, { code: 'OAUTH_NOT_CONFIGURED' });
  return p;
}

/** Providers for the login/register UI. Unconfigured ones are listed (disabled) only outside production. */
function listProviders() {
  return Object.entries(PROVIDERS)
    .map(([id, p]) => ({ id, name: p.name, enabled: p.configured() }))
    .filter((p) => p.enabled || !env.isProd);
}

/** Begin sign-in: remember state (+ PKCE verifier) in the session and return the provider URL. */
function start(req, providerKey, { next, mode }) {
  const p = getProvider(providerKey);
  const state = randomToken(24);
  const verifier = b64url(crypto.randomBytes(48));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  req.session.oauth = { provider: providerKey, state, verifier: p.pkce ? verifier : null, next, mode, at: Date.now() };
  return p.authorizeUrl({ state, challenge, redirectUri: redirectUriFor(providerKey) });
}

/**
 * Finish sign-in. Returns { user, next, linked } on success; throws AppError with a user-facing message otherwise.
 */
async function callback(req, providerKey, { code, state, error }) {
  const saved = req.session.oauth;
  delete req.session.oauth; // single use
  if (error) throw AppError.badRequest(error === 'access_denied' ? 'Sign-in was cancelled.' : 'The sign-in provider returned an error.');
  if (!saved || saved.provider !== providerKey || !safeEqual(saved.state, state) || Date.now() - saved.at > STATE_TTL_MS) {
    throw AppError.badRequest('Your sign-in session expired or is invalid. Please try again.');
  }
  if (!code) throw AppError.badRequest('Missing authorization code.');
  const p = getProvider(providerKey);
  const prof = await p.profile({ code, verifier: saved.verifier, redirectUri: redirectUriFor(providerKey) });
  const emailAddr = prof.email ? prof.email.toLowerCase() : null;

  // ── Link mode: a logged-in customer connects a provider from their profile ──
  if (saved.mode === 'link') {
    if (!req.user) throw AppError.unauthorized('Please log in again to connect your account.');
    const owner = await prisma.oAuthAccount.findUnique({ where: { provider_providerUserId: { provider: providerKey, providerUserId: prof.id } } });
    if (owner && owner.userId !== req.user.id) throw AppError.conflict(`This ${p.name} account is already connected to another StayEase account.`);
    await prisma.oAuthAccount.upsert({
      where: { userId_provider: { userId: req.user.id, provider: providerKey } },
      create: { userId: req.user.id, provider: providerKey, providerUserId: prof.id, email: emailAddr },
      update: { providerUserId: prof.id, email: emailAddr, lastUsedAt: new Date() },
    });
    await audit.log(req, 'OAUTH_LINKED', { entityType: 'user', entityId: req.user.id, description: p.name });
    return { user: req.user, next: saved.next || '/customer/profile.html', linked: true };
  }

  // ── Sign-in / sign-up ──
  let user;
  const link = await prisma.oAuthAccount.findUnique({ where: { provider_providerUserId: { provider: providerKey, providerUserId: prof.id } }, include: { user: true } });
  if (link) {
    user = link.user;
    await prisma.oAuthAccount.update({ where: { id: link.id }, data: { lastUsedAt: new Date(), email: emailAddr ?? link.email } });
  } else {
    if (!emailAddr) throw AppError.badRequest(`Your ${p.name} account did not share an email address. Please sign up with email instead.`);
    const existing = await prisma.user.findUnique({ where: { email: emailAddr } });
    if (existing) {
      if (!prof.emailVerified) {
        throw AppError.conflict(`An account with ${emailAddr} already exists. Log in with your email and password, then connect ${p.name} from your profile.`);
      }
      user = existing;
      await prisma.oAuthAccount.create({ data: { userId: user.id, provider: providerKey, providerUserId: prof.id, email: emailAddr } });
      if (!user.emailVerifiedAt) user = await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
      await audit.log({ ...req, user }, 'OAUTH_LINKED', { entityType: 'user', entityId: user.id, description: `${p.name} (verified email match)` });
    } else {
      user = await prisma.user.create({
        data: {
          firstName: prof.firstName.slice(0, 80), lastName: (prof.lastName || '-').slice(0, 80), email: emailAddr, passwordHash: null, role: 'CUSTOMER',
          emailVerifiedAt: prof.emailVerified ? new Date() : null,
          oauthAccounts: { create: { provider: providerKey, providerUserId: prof.id, email: emailAddr } },
        },
      });
      if (!prof.emailVerified) {
        const auth = require('./auth.service');
        await auth.resendVerification(user).catch(() => {});
      }
      await audit.log({ ...req, user }, 'USER_REGISTERED', { entityType: 'user', entityId: user.id, description: `via ${p.name}` });
    }
  }
  if (user.role !== 'CUSTOMER') throw AppError.forbidden('Staff accounts must sign in with email and password.');
  if (user.accountStatus !== 'ACTIVE') throw AppError.forbidden('This account has been deactivated. Please contact the hotel.');
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  return { user, next: saved.next, linked: false };
}

async function linkedProviders(userId) {
  const rows = await prisma.oAuthAccount.findMany({ where: { userId }, select: { provider: true, email: true, createdAt: true } });
  return rows.map((r) => ({ provider: r.provider, email: r.email, connected_at: r.createdAt }));
}

/** Disconnect a provider — refused if it is the account's only way to sign in. */
async function unlink(req, providerKey) {
  const links = await prisma.oAuthAccount.findMany({ where: { userId: req.user.id } });
  const target = links.find((l) => l.provider === providerKey);
  if (!target) throw AppError.notFound('This provider is not connected.');
  if (!req.user.passwordHash && links.length === 1) throw AppError.conflict('Set a password first — otherwise you would have no way to sign in.');
  await prisma.oAuthAccount.delete({ where: { id: target.id } });
  await audit.log(req, 'OAUTH_UNLINKED', { entityType: 'user', entityId: req.user.id, description: PROVIDERS[providerKey]?.name || providerKey });
}

module.exports = { PROVIDERS, listProviders, start, callback, linkedProviders, unlink, redirectUriFor };
