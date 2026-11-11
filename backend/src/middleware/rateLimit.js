const rateLimit = require('express-rate-limit');
const env = require('../config/env');
const { PrismaRateLimitStore } = require('../utils/rateLimitStore');

const json = (message) => ({ error: { message, code: 'RATE_LIMITED' } });
const skip = () => env.isTest;

// If the counter table is unreachable, let the request through rather than locking everyone out.
const shared = { standardHeaders: 'draft-7', legacyHeaders: false, skip, passOnStoreError: true };

// Brute-force protection on login / password endpoints. Counted in the database so the limit holds
// across all serverless instances.
const authLimiter = rateLimit({
  ...shared,
  windowMs: 15 * 60 * 1000,
  limit: 20,
  store: new PrismaRateLimitStore({ prefix: 'auth:' }),
  message: json('Too many attempts. Please wait 15 minutes and try again.'),
});

// Email-sending endpoints (forgot password, resend verification). Also database-backed.
const emailLimiter = rateLimit({
  ...shared,
  windowMs: 60 * 60 * 1000,
  limit: 6,
  store: new PrismaRateLimitStore({ prefix: 'email:' }),
  message: json('Too many email requests. Please try again later.'),
});

// General API ceiling. Kept in memory (per instance) to avoid a database write on every request;
// Vercel's platform DDoS protection sits in front of it.
const apiLimiter = rateLimit({
  ...shared,
  windowMs: 60 * 1000,
  limit: 300,
  message: json('Too many requests. Please slow down.'),
});

module.exports = { authLimiter, emailLimiter, apiLimiter };
