const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env'), quiet: true });

const bool = (v, d = false) => (v === undefined || v === '' ? d : ['1', 'true', 'yes'].includes(String(v).toLowerCase()));

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  isProd: process.env.NODE_ENV === 'production',
  isTest: process.env.NODE_ENV === 'test',
  port: Number(process.env.PORT || 4000),
  appUrl: (process.env.APP_URL || 'http://localhost:4000').replace(/\/$/, ''),
  timezone: process.env.HOTEL_TIMEZONE || 'Asia/Manila',
  sessionSecret: process.env.SESSION_SECRET,
  // true = one proxy in front (e.g. Nginx or Railway); a number = that many hops (e.g. 2 for Vercel → Railway).
  trustProxy: /^\d+$/.test(process.env.TRUST_PROXY || '') ? Number(process.env.TRUST_PROXY) : bool(process.env.TRUST_PROXY) ? 1 : 0,
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
