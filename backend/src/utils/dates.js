const env = require('../config/env');
const AppError = require('./AppError');

const DAY = 24 * 60 * 60 * 1000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Parse 'YYYY-MM-DD' into a UTC-midnight Date (how Prisma stores @db.Date). */
function parseDate(str, field = 'date') {
  if (typeof str !== 'string' || !ISO_DATE.test(str)) throw AppError.badRequest(`${field} must be a date in YYYY-MM-DD format.`);
  const d = new Date(`${str}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== str) throw AppError.badRequest(`${field} is not a valid date.`);
  return d;
}
const formatDate = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);

/** Today's calendar date in the hotel's timezone, as a UTC-midnight Date. */
function hotelToday(now = new Date()) {
  const s = new Intl.DateTimeFormat('en-CA', { timeZone: env.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  return parseDate(s);
}
/** Offset (ms) of the hotel timezone from UTC at a given instant. */
function tzOffsetMs(at) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: env.timezone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(at).filter((p) => p.type !== 'literal').map((p) => [p.type, Number(p.value)]));
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - Math.floor(at.getTime() / 1000) * 1000;
}

/** Exact instant for a calendar date + 'HH:MM' wall-clock time at the hotel. */
function hotelDateTime(date, hhmm = '00:00') {
  const [h, m] = hhmm.split(':').map(Number);
  const wall = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), h, m);
  return new Date(wall - tzOffsetMs(new Date(wall)));
}

/** Hotel UTC offset as '+08:00'. */
function tzOffsetString(at = new Date()) {
  const mins = Math.round(tzOffsetMs(at) / 60000);
  const sign = mins >= 0 ? '+' : '-';
  const abs = Math.abs(mins);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

const addDays = (d, n) => new Date(d.getTime() + n * DAY);
const nightsBetween = (a, b) => Math.round((b.getTime() - a.getTime()) / DAY);

module.exports = { parseDate, formatDate, hotelToday, hotelDateTime, tzOffsetString, addDays, nightsBetween, DAY };
