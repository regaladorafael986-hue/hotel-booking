// express-session store backed by the Prisma `sessions` table (keeps the schema under Prisma migrations).
const session = require('express-session');
const prisma = require('../config/prisma');

const DEFAULT_TTL_MS = 1000 * 60 * 60 * 24 * 7;

class PrismaSessionStore extends session.Store {
  constructor() {
    super();
    this.cleanupTimer = setInterval(() => this.prune().catch(() => {}), 1000 * 60 * 30);
    this.cleanupTimer.unref();
  }

  expiry(sess) {
    const maxAge = sess?.cookie?.maxAge;
    return new Date(Date.now() + (typeof maxAge === 'number' ? maxAge : DEFAULT_TTL_MS));
  }

  get(sid, cb) {
    prisma.session
      .findUnique({ where: { sid } })
      .then((row) => {
        if (!row || row.expiresAt < new Date()) return cb(null, null);
        cb(null, JSON.parse(row.data));
      })
      .catch(cb);
  }

  set(sid, sess, cb = () => {}) {
    const data = JSON.stringify(sess);
    const expiresAt = this.expiry(sess);
    prisma.session
      .upsert({ where: { sid }, create: { sid, data, expiresAt }, update: { data, expiresAt } })
      .then(() => cb(null))
      .catch(cb);
  }

  touch(sid, sess, cb = () => {}) {
    prisma.session
      .updateMany({ where: { sid }, data: { expiresAt: this.expiry(sess) } })
      .then(() => cb(null))
      .catch(cb);
  }

  destroy(sid, cb = () => {}) {
    prisma.session.deleteMany({ where: { sid } }).then(() => cb(null)).catch(cb);
  }

  /** Remove all sessions belonging to a user (used after password reset / deactivation). */
  async destroyUserSessions(userId, exceptSid) {
    const rows = await prisma.session.findMany({ where: { data: { contains: `"userId":${userId}` } }, select: { sid: true, data: true } });
    const sids = rows.filter((r) => r.sid !== exceptSid && JSON.parse(r.data).userId === userId).map((r) => r.sid);
    if (sids.length) await prisma.session.deleteMany({ where: { sid: { in: sids } } });
  }

  prune() {
    return prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  }
}

const store = new PrismaSessionStore();
module.exports = { store, PrismaSessionStore };
