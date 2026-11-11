const path = require('path');
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const morgan = require('morgan');
const env = require('./config/env');
const { store } = require('./utils/sessionStore');
const { loadUser } = require('./middleware/auth');
const { csrfProtection } = require('./middleware/csrf');
const { apiLimiter } = require('./middleware/rateLimit');
const { notFound, errorHandler } = require('./middleware/error');
const { safeEqual } = require('./utils/crypto');
const tasks = require('./jobs/tasks');
const paymentController = require('./controllers/payment.controller');
const { UPLOAD_DIR } = require('./services/storage.service');
const routes = require('./routes');

const FRONTEND_DIR = path.join(__dirname, '..', '..', 'frontend');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (env.trustProxy) app.set('trust proxy', env.trustProxy);

  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        'style-src': ["'self'", 'https://fonts.googleapis.com', "'unsafe-inline'"],
        'font-src': ["'self'", 'https://fonts.gstatic.com', 'data:'],
        'img-src': ["'self'", 'data:', 'blob:', 'https://images.unsplash.com', 'https://res.cloudinary.com'],
        'connect-src': ["'self'"],
        'frame-src': ['https://www.google.com', 'https://maps.google.com'],
        'form-action': ["'self'"],
        'upgrade-insecure-requests': env.isProd ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
  }));
  if (!env.isTest) app.use(morgan(env.isProd ? 'combined' : 'dev', { skip: (req) => !req.originalUrl.startsWith('/api') }));

  // Scheduled jobs (Vercel Cron). Mounted before sessions so cron calls never create a session.
  // Vercel sends "Authorization: Bearer <CRON_SECRET>"; without CRON_SECRET configured the endpoint is disabled.
  app.get('/api/cron/:job', async (req, res, next) => {
    try {
      res.set('Cache-Control', 'no-store');
      if (!env.cronSecret) return res.status(503).json({ error: { message: 'Scheduled jobs are not configured (CRON_SECRET is not set).', code: 'CRON_DISABLED' } });
      if (!safeEqual(req.get('authorization') || '', `Bearer ${env.cronSecret}`)) return res.status(401).json({ error: { message: 'Unauthorized.', code: 'UNAUTHORIZED' } });
      const names = tasks.JOBS[req.params.job];
      if (!names) return res.status(404).json({ error: { message: 'Unknown job.', code: 'NOT_FOUND' } });
      const results = await tasks.run(names);
      res.status(Object.values(results).every((r) => r.ok) ? 200 : 500).json({ job: req.params.job, results });
    } catch (err) { next(err); }
  });

  // Payment webhooks need the exact raw bytes for signature verification — mount BEFORE the JSON parser.
  app.post('/api/v1/payments/webhook', express.raw({ type: '*/*', limit: '1mb' }), paymentController.webhook);

  app.use(express.json({ limit: '200kb' }));
  app.use(express.urlencoded({ extended: false, limit: '200kb' }));

  app.use(session({
    name: 'stayease.sid',
    secret: env.sessionSecret,
    store,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: { httpOnly: true, sameSite: 'lax', secure: env.isProd, maxAge: 1000 * 60 * 60 * 24 * 7 },
  }));

  app.use('/api', apiLimiter);
  app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.use('/api', loadUser);
  app.use('/api', csrfProtection);
  // Serverless has no timers: expire lapsed unpaid holds on demand (throttled per instance).
  if (env.isVercel) app.use('/api/v1', (req, res, next) => { tasks.maybeExpireHolds().then(() => next(), next); });
  app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));
  app.use('/api/v1', routes);
  app.use('/api', notFound);

  // On Vercel only /api/* reaches this app: the CDN serves the frontend (see frontend/vercel.json).
  if (env.isVercel) {
    app.use((req, res) => res.status(404).json({ error: { message: 'Not found.', code: 'NOT_FOUND' } }));
    app.use(errorHandler);
    return app;
  }

  // Local server: uploaded images (local storage fallback) and the frontend.
  app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d', index: false, dotfiles: 'deny' }));
  app.use('/vendor/chart.js', express.static(path.dirname(require.resolve('chart.js')), { maxAge: '30d' }));
  app.use(express.static(FRONTEND_DIR, { extensions: ['html'], maxAge: env.isProd ? '1h' : 0 }));
  app.use((req, res) => res.status(404).sendFile(path.join(FRONTEND_DIR, '404.html')));

  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
