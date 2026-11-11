// express-rate-limit store backed by the `rate_limits` table, so limits hold across serverless
// instances. One atomic upsert per counted request: a fixed window per key that restarts when expired.
const prisma = require('../config/prisma');
const { utcTimestamp } = require('./sql');

class PrismaRateLimitStore {
  /** @param {{ prefix: string }} opts  distinct prefix per limiter, e.g. "auth:" */
  constructor({ prefix }) {
    this.prefix = prefix;
    this.localKeys = false; // shared between instances
  }

  init(options) {
    this.windowMs = options.windowMs;
  }

  async increment(key) {
    const now = new Date();
    const resetAt = new Date(now.getTime() + this.windowMs);
    const k = this.prefix + key;
    const [row] = await prisma.$queryRaw`
      INSERT INTO rate_limits (key, hits, reset_at) VALUES (${k}, 1, ${utcTimestamp(resetAt)})
      ON CONFLICT (key) DO UPDATE SET
        hits     = CASE WHEN rate_limits.reset_at <= ${utcTimestamp(now)} THEN 1 ELSE rate_limits.hits + 1 END,
        reset_at = CASE WHEN rate_limits.reset_at <= ${utcTimestamp(now)} THEN EXCLUDED.reset_at ELSE rate_limits.reset_at END
      RETURNING hits, reset_at AS "resetAt"`;
    return { totalHits: Number(row.hits), resetTime: new Date(row.resetAt) };
  }

  async decrement(key) {
    await prisma.rateLimit.updateMany({ where: { key: this.prefix + key, hits: { gt: 0 } }, data: { hits: { decrement: 1 } } });
  }

  async resetKey(key) {
    await prisma.rateLimit.deleteMany({ where: { key: this.prefix + key } });
  }

  async get(key) {
    const row = await prisma.rateLimit.findUnique({ where: { key: this.prefix + key } });
    if (!row || row.resetAt <= new Date()) return undefined;
    return { totalHits: row.hits, resetTime: row.resetAt };
  }
}

module.exports = { PrismaRateLimitStore };
