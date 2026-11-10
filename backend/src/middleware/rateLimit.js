const rateLimit = require('express-rate-limit');
const env = require('../config/env');

const json = (message) => ({ error: { message, code: 'RATE_LIMITED' } });
const skip = () => env.isTest;

// Brute-force protection on login / password endpoints.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip,
  message: json('Too many attempts. Please wait 15 minutes and try again.'),
});

// Email-sending endpoints (forgot password, resend verification).
const emailLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 6,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip,
  message: json('Too many email requests. Please try again later.'),
});

// General API ceiling.
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip,
  message: json('Too many requests. Please slow down.'),
});

module.exports = { authLimiter, emailLimiter, apiLimiter };
