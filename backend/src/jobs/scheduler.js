// In-process background jobs. For multi-instance deployments run only one scheduler (set RUN_JOBS=false elsewhere).
const bookings = require('../services/booking.service');

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
  every(60 * 1000, 'expire-holds', () => bookings.expireHolds());
  every(30 * 60 * 1000, 'check-in-reminders', () => bookings.sendCheckInReminders());
}

const stop = () => timers.forEach(clearInterval);

module.exports = { start, stop };
