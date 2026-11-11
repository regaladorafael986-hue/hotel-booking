// The app as Vercel runs it: loaded through frontend/api/index.js with VERCEL=1 (no timers, read-only
// disk, CDN serves the pages). Covers the cron endpoint, on-demand hold expiry, the shared rate-limit
// store, and serverless-only behaviour (uploads need Cloudinary, non-API paths are not served here).
process.env.VERCEL = '1';
process.env.DATABASE_SCHEMA = process.env.DATABASE_SCHEMA || 'public'; // required on Vercel (startup guard)
process.env.CRON_SECRET = 'test-cron-secret-0123456789';
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const h = require('./helpers');

let app;
before(async () => {
  await h.reset();
  app = require(path.join(__dirname, '..', '..', 'frontend', 'api', 'index.js'));
});
after(async () => { await h.prisma().$disconnect(); });

const lapse = (id) => h.prisma().booking.update({ where: { id }, data: { expiresAt: new Date(Date.now() - 1000) } });

describe('vercel serverless mode', () => {
  test('unpaid holds expire on demand without any background timer', async () => {
    const rt = await h.makeRoomType({ name: 'Lazy Expiry', rooms: 1 });
    const c = await h.login(app, await h.makeUser());
    const b = (await c.post('/api/v1/bookings').send(h.bookingBody(rt, { method: 'ONLINE', inDays: 20 }))).body.booking;
    assert.equal(b.booking_status, 'PENDING_PAYMENT');
    await lapse(b.id);
    // Within the throttle window nothing runs; once it has passed, the next API request expires it.
    assert.equal((await c.get(`/api/v1/bookings/${b.id}`)).body.booking.booking_status, 'PENDING_PAYMENT');
    require('../src/jobs/tasks').resetLazyThrottle();
    const res = await c.get(`/api/v1/bookings/${b.id}`);
    assert.equal(res.body.booking.booking_status, 'EXPIRED');
  });

  test('the function entry point serves the existing API routes', async () => {
    const health = await h.request(app).get('/api/health');
    assert.equal(health.status, 200);
    assert.equal(health.body.status, 'ok');
    const rooms = await h.request(app).get('/api/v1/rooms');
    assert.equal(rooms.status, 200, JSON.stringify(rooms.body));
    const csrf = await h.request(app).get('/api/v1/auth/csrf');
    assert.ok(csrf.body.csrf_token);
    assert.match(String(csrf.headers['set-cookie']), /stayease\.sid=.*HttpOnly/i);
  });

  test('pages are not served by the function (the CDN serves them)', async () => {
    const res = await h.request(app).get('/rooms.html');
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
  });

  test('cron endpoint requires the secret and runs the daily jobs', async () => {
    assert.equal((await h.request(app).get('/api/cron/daily')).status, 401);
    assert.equal((await h.request(app).get('/api/cron/daily').set('authorization', 'Bearer wrong')).status, 401);
    assert.equal((await h.request(app).get('/api/cron/nope').set('authorization', `Bearer ${process.env.CRON_SECRET}`)).status, 404);

    const rt = await h.makeRoomType({ name: 'Cron Expiry', rooms: 1 });
    const c = await h.login(app, await h.makeUser());
    const b = (await c.post('/api/v1/bookings').send(h.bookingBody(rt, { method: 'ONLINE', inDays: 25 }))).body.booking;
    await lapse(b.id);
    await h.prisma().session.create({ data: { sid: 'expired-session', data: '{}', expiresAt: new Date(Date.now() - 1000) } });
    await h.prisma().rateLimit.create({ data: { key: 'auth:old', hits: 3, resetAt: new Date(Date.now() - 1000) } });

    const res = await h.request(app).get('/api/cron/daily').set('authorization', `Bearer ${process.env.CRON_SECRET}`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.headers['set-cookie'], undefined, 'cron calls do not create sessions');
    assert.deepEqual(Object.keys(res.body.results), ['expire-holds', 'check-in-reminders', 'prune-sessions', 'prune-rate-limits']);
    assert.ok(Object.values(res.body.results).every((r) => r.ok));
    assert.equal((await h.prisma().booking.findUnique({ where: { id: b.id } })).bookingStatus, 'EXPIRED');
    assert.equal(await h.prisma().session.count({ where: { sid: 'expired-session' } }), 0);
    assert.equal(await h.prisma().rateLimit.count({ where: { key: 'auth:old' } }), 0);
  });

  test('image uploads need Cloudinary on Vercel (no writes to the read-only disk)', async () => {
    const a = await h.login(app, await h.makeUser('ADMIN'));
    const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
    const res = await a.agent.post('/api/v1/admin/settings/images').set('x-csrf-token', a.agent.token).attach('images', png, { filename: 'x.png', contentType: 'image/png' });
    assert.equal(res.status, 503, JSON.stringify(res.body));
    assert.equal(res.body.error.code, 'UPLOADS_NOT_CONFIGURED');
  });

  test('rate-limit counters are shared through the database and reset after the window', async () => {
    const { PrismaRateLimitStore } = require('../src/utils/rateLimitStore');
    const s1 = new PrismaRateLimitStore({ prefix: 'test:' });
    const s2 = new PrismaRateLimitStore({ prefix: 'test:' }); // a second "instance"
    s1.init({ windowMs: 60_000 });
    s2.init({ windowMs: 60_000 });
    assert.equal((await s1.increment('1.2.3.4')).totalHits, 1);
    assert.equal((await s2.increment('1.2.3.4')).totalHits, 2);
    const third = await s1.increment('1.2.3.4');
    assert.equal(third.totalHits, 3);
    assert.ok(third.resetTime > new Date() && third.resetTime <= new Date(Date.now() + 60_000));
    await s1.decrement('1.2.3.4');
    assert.equal((await s2.get('1.2.3.4')).totalHits, 2);
    // Window over → the next hit starts a new window.
    await h.prisma().rateLimit.update({ where: { key: 'test:1.2.3.4' }, data: { resetAt: new Date(Date.now() - 1) } });
    assert.equal((await s2.increment('1.2.3.4')).totalHits, 1);
    await s1.resetKey('1.2.3.4');
    assert.equal(await s1.get('1.2.3.4'), undefined);
  });
});
