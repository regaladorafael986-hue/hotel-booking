/**
 * Background tasks, shared by the in-process scheduler (local `npm start`) and the Vercel Cron
 * endpoint (`GET /api/cron/:job`). Every task is idempotent and safe to run more than once.
 *
 * Booking correctness never depends on these running on time: availability already ignores holds
 * whose expires_at has passed, and late payments are re-checked. The tasks tidy statuses, release
 * coupon usage, send emails and delete expired rows.
 */
const prisma = require('../config/prisma');
const bookings = require('../services/booking.service');

const pruneSessions = async (now = new Date()) => (await prisma.session.deleteMany({ where: { expiresAt: { lt: now } } })).count;
const pruneRateLimits = async (now = new Date()) => (await prisma.rateLimit.deleteMany({ where: { resetAt: { lt: now } } })).count;

const TASKS = {
  'expire-holds': () => bookings.expireHolds(),
  'check-in-reminders': () => bookings.sendCheckInReminders(),
  'prune-sessions': () => pruneSessions(),
  'prune-rate-limits': () => pruneRateLimits(),
};

/** Runs the named tasks in order and reports each result; one failure does not stop the others. */
async function run(names) {
  const results = {};
  for (const name of names) {
    const started = Date.now();
    try {
      results[name] = { ok: true, processed: (await TASKS[name]()) || 0, ms: Date.now() - started };
    } catch (err) {
      console.error(`[job:${name}] failed:`, err.message);
      results[name] = { ok: false, error: err.message, ms: Date.now() - started };
    }
  }
  return results;
}

// Cron entry points. Vercel Hobby allows one run per day per cron job, so "daily" runs everything.
const JOBS = {
  daily: Object.keys(TASKS),
  'expire-holds': ['expire-holds'],
  'check-in-reminders': ['check-in-reminders'],
  cleanup: ['prune-sessions', 'prune-rate-limits'],
};

// Serverless instances do not run timers, so unpaid holds are also expired on demand while the
// site is in use: at most once per interval per instance, before the request is handled.
const LAZY_INTERVAL_MS = 60 * 1000;
let lastLazyRun = 0;
let lazyRunning = null;

async function maybeExpireHolds(now = Date.now()) {
  if (lazyRunning) return lazyRunning;
  if (now - lastLazyRun < LAZY_INTERVAL_MS) return 0;
  lastLazyRun = now;
  lazyRunning = bookings.expireHolds()
    .catch((err) => { console.error('[job:expire-holds:lazy] failed:', err.message); return 0; })
    .finally(() => { lazyRunning = null; });
  return lazyRunning;
}

/** Tests only: forget the last on-demand run, as if the throttle interval had passed. */
const resetLazyThrottle = () => { lastLazyRun = 0; };

module.exports = { TASKS, JOBS, run, pruneSessions, pruneRateLimits, maybeExpireHolds, resetLazyThrottle, LAZY_INTERVAL_MS };
