const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env'), quiet: true });

const bool = (v, d = false) => (v === undefined || v === '' ? d : ['1', 'true', 'yes'].includes(String(v).toLowerCase()));
const isVercel = Boolean(process.env.VERCEL);

/** Public site URL for emails, OAuth and payment redirects. APP_URL wins; on Vercel it falls back to the deployment's own URL. */
function resolveAppUrl() {
  if (process.env.APP_URL) return process.env.APP_URL;
  if (process.env.VERCEL_ENV === 'production' && process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (process.env.VERCEL_BRANCH_URL) return `https://${process.env.VERCEL_BRANCH_URL}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'http://localhost:4000';
}

/** Proxy hops to trust for client IP / HTTPS detection. TRUST_PROXY: true = 1 hop, or a number. Vercel's edge is 1 hop. */
function resolveTrustProxy() {
  const v = process.env.TRUST_PROXY;
  if (/^\d+$/.test(v || '')) return Number(v);
  if (v !== undefined && v !== '') return bool(v) ? 1 : 0;
  return isVercel ? 1 : 0;
}

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  isProd: process.env.NODE_ENV === 'production',
  isTest: process.env.NODE_ENV === 'test',
  isVercel, // serverless: no long-running timers, read-only filesystem
  port: Number(process.env.PORT || 4000),
  appUrl: resolveAppUrl().replace(/\/$/, ''),
  timezone: process.env.HOTEL_TIMEZONE || 'Asia/Manila',
  sessionSecret: process.env.SESSION_SECRET,
  trustProxy: resolveTrustProxy(),
  cronSecret: process.env.CRON_SECRET || '', // Vercel Cron sends it as "Authorization: Bearer <CRON_SECRET>"
  requireVerifiedEmailForBooking: bool(process.env.REQUIRE_EMAIL_VERIFICATION_FOR_BOOKING, true),
  brevo: {
    apiKey: process.env.BREVO_API_KEY || '',
    fromEmail: process.env.MAIL_FROM_EMAIL || 'no-reply@stayease.example',
    fromName: process.env.MAIL_FROM_NAME || 'StayEase',
  },
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME || '',
    apiKey: process.env.CLOUDINARY_API_KEY || '',
    apiSecret: process.env.CLOUDINARY_API_SECRET || '',
    folder: process.env.CLOUDINARY_FOLDER || 'stayease',
  },
  oauth: {
    google: { clientId: process.env.GOOGLE_CLIENT_ID || '', clientSecret: process.env.GOOGLE_CLIENT_SECRET || '' },
    facebook: { clientId: process.env.FACEBOOK_APP_ID || '', clientSecret: process.env.FACEBOOK_APP_SECRET || '', graphVersion: process.env.FACEBOOK_GRAPH_VERSION || 'v19.0' },
  },
  payments: {
    provider: (process.env.PAYMENT_PROVIDER || 'mock').toLowerCase(),
    mockWebhookSecret: process.env.MOCK_WEBHOOK_SECRET || 'dev-mock-webhook-secret',
    paymongoSecretKey: process.env.PAYMONGO_SECRET_KEY || '',
    paymongoWebhookSecret: process.env.PAYMONGO_WEBHOOK_SECRET || '',
    paymongoLiveMode: bool(process.env.PAYMONGO_LIVE_MODE),
  },
};

if (!env.sessionSecret || env.sessionSecret.length < 16) {
  if (env.isProd) throw new Error('SESSION_SECRET must be set (>=16 chars) in production');
  env.sessionSecret = env.sessionSecret || 'insecure-dev-session-secret-change-me';
}
// A public demo may run the simulator in production only when explicitly opted in; it never moves real money.
env.payments.allowMockInProduction = bool(process.env.ALLOW_MOCK_PAYMENTS);
if (env.isProd && env.payments.provider === 'mock' && !env.payments.allowMockInProduction) {
  throw new Error('PAYMENT_PROVIDER=mock is not allowed in production. Configure a real payment provider (or set ALLOW_MOCK_PAYMENTS=true for a demo site).');
}
if (env.isProd && env.payments.provider === 'mock' && env.payments.mockWebhookSecret === 'dev-mock-webhook-secret') {
  throw new Error('Set MOCK_WEBHOOK_SECRET to a random value when running the payment simulator in production.');
}

module.exports = env;
