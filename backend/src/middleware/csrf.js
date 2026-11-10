// Synchronizer-token CSRF protection for cookie-session auth.
// The token lives in the server-side session; clients fetch it from GET /api/v1/auth/csrf
// and send it back in the X-CSRF-Token header on every state-changing request.
const { randomToken, safeEqual } = require('../utils/crypto');
const AppError = require('../utils/AppError');

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);
const EXEMPT = [/^\/api\/v1\/payments\/webhook/]; // signed by the payment provider instead

function ensureCsrfToken(req) {
  if (!req.session.csrfToken) req.session.csrfToken = randomToken(24);
  return req.session.csrfToken;
}

function csrfProtection(req, res, next) {
  if (SAFE.has(req.method) || EXEMPT.some((re) => re.test(req.originalUrl))) return next();
  const sent = req.get('x-csrf-token');
  if (!req.session?.csrfToken || !safeEqual(sent, req.session.csrfToken)) {
    return next(new AppError(403, 'Invalid or missing security token. Please refresh the page and try again.', { code: 'CSRF' }));
  }
  next();
}

module.exports = { csrfProtection, ensureCsrfToken };
