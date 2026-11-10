// Convert Prisma results (Decimal, Date, camelCase) into plain JSON objects with snake_case keys.
const { Prisma } = require('@prisma/client');

const snake = (k) => k.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
const DATE_ONLY_KEYS = new Set(['checkIn', 'checkOut', 'startDate', 'endDate']);
const HIDDEN_KEYS = new Set(['passwordHash', 'tokenHash']);

function serialize(value, key) {
  if (value === null || value === undefined) return null;
  if (value instanceof Prisma.Decimal) return Number(value.toString());
  if (value instanceof Date) return DATE_ONLY_KEYS.has(key) ? value.toISOString().slice(0, 10) : value.toISOString();
  if (typeof value === 'bigint') return Number(value);
  if (Array.isArray(value)) return value.map((v) => serialize(v));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (HIDDEN_KEYS.has(k)) continue;
      out[snake(k)] = serialize(v, k);
    }
    return out;
  }
  return value;
}
module.exports = { serialize };
