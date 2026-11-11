// In-process background jobs for the long-running server (`npm start` / `npm run dev`).
// On Vercel there is no long-running process: the same tasks run from Vercel Cron (GET /api/cron/:job)
// and holds are also expired on demand (see tasks.maybeExpireHolds).
// For multi-instance servers run only one scheduler (set RUN_JOBS=false elsewhere).
const tasks = require('./tasks');

const timers = [];

function every(ms, name, fn) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const n = await fn();
      if (n) console.log(`[job:${name}] processed ${n}`);
    } catch (err) {
      console.error(`[job:${name}] failed:`, err.message);
    } finally {
      running = false;
    }
  };
  setTimeout(tick, 2000).unref();
  const t = setInterval(tick, ms);
  t.unref();
  timers.push(t);
}

function start() {
  if (process.env.RUN_JOBS === 'false') return;
  every(60 * 1000, 'expire-holds', tasks.TASKS['expire-holds']);
  every(30 * 60 * 1000, 'check-in-reminders', tasks.TASKS['check-in-reminders']);
  every(30 * 60 * 1000, 'cleanup', async () => (await tasks.pruneSessions()) + (await tasks.pruneRateLimits()));
}

const stop = () => timers.forEach(clearInterval);

module.exports = { start, stop };
