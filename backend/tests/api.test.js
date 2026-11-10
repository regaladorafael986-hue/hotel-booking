const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

let app;
before(async () => {
  await h.reset();
  app = h.createApp();
});
after(async () => { await h.prisma().$disconnect(); });

describe('authentication & security', () => {
  test('register → me → logout → login', async () => {
    const agent = h.request.agent(app);
    const token = await h.csrf(agent);
    const reg = await agent.post('/api/v1/auth/register').set('x-csrf-token', token)
      .send({ first_name: 'Ana', last_name: 'Cruz', email: 'ana@test.dev', password: 'secret123', confirm_password: 'secret123' });
    assert.equal(reg.status, 201, JSON.stringify(reg.body));
    assert.equal(reg.body.user.email_verified, false);
    const me = await agent.get('/api/v1/auth/me');
    assert.equal(me.body.user.email, 'ana@test.dev');
    const out = await agent.post('/api/v1/auth/logout').set('x-csrf-token', reg.body.csrf_token);
    assert.equal(out.status, 200);
    assert.equal((await agent.get('/api/v1/auth/me')).body.user, null);
    const user = await h.prisma().user.findUnique({ where: { email: 'ana@test.dev' } });
    assert.ok(user.passwordHash.startsWith('$2'), 'password is bcrypt-hashed');
  });

  test('rejects weak passwords, duplicate emails and wrong credentials', async () => {
    const agent = h.request.agent(app);
    const t = await h.csrf(agent);
    const weak = await agent.post('/api/v1/auth/register').set('x-csrf-token', t).send({ first_name: 'A', last_name: 'B', email: 'weak@test.dev', password: 'short' });
    assert.equal(weak.status, 400);
    assert.ok(weak.body.error.details.fields.password);
    const dup = await agent.post('/api/v1/auth/register').set('x-csrf-token', t).send({ first_name: 'A', last_name: 'B', email: 'ana@test.dev', password: 'secret123' });
    assert.equal(dup.status, 409);
    const bad = await agent.post('/api/v1/auth/login').set('x-csrf-token', t).send({ email: 'ana@test.dev', password: 'wrongpass1' });
    assert.equal(bad.status, 401);
  });

  test('state-changing requests without a CSRF token are rejected', async () => {
    const res = await h.request(app).post('/api/v1/auth/login').send({ email: 'x@test.dev', password: 'whatever1' });
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'CSRF');
  });

  test('email verification and password reset tokens work once', async () => {
    const user = await h.makeUser('CUSTOMER', { emailVerifiedAt: null });
    const crypto = require('../src/utils/crypto');
    const token = crypto.randomToken(32);
    await h.prisma().authToken.create({ data: { userId: user.id, type: 'EMAIL_VERIFICATION', tokenHash: crypto.sha256(token), expiresAt: new Date(Date.now() + 60000) } });
    const agent = h.request.agent(app);
    const t = await h.csrf(agent);
    assert.equal((await agent.post('/api/v1/auth/verify-email').set('x-csrf-token', t).send({ token })).status, 200);
    assert.equal((await agent.post('/api/v1/auth/verify-email').set('x-csrf-token', t).send({ token })).status, 400, 'token cannot be reused');
    assert.ok((await h.prisma().user.findUnique({ where: { id: user.id } })).emailVerifiedAt);

    const fp = await agent.post('/api/v1/auth/forgot-password').set('x-csrf-token', t).send({ email: 'nobody@test.dev' });
    assert.equal(fp.status, 200, 'same response for unknown email (no enumeration)');
  });

  test('role-based access control', async () => {
    const c = await h.login(app, await h.makeUser('CUSTOMER'));
    assert.equal((await c.get('/api/v1/admin/dashboard')).status, 403);
    assert.equal((await c.get('/api/v1/staff/arrivals')).status, 403);
    const s = await h.login(app, await h.makeUser('RECEPTIONIST'));
    assert.equal((await s.get('/api/v1/staff/arrivals')).status, 200);
    assert.equal((await s.get('/api/v1/admin/dashboard')).status, 403);
    const limited = await h.login(app, await h.makeUser('RECEPTIONIST', { permissions: ['check_in'] }));
    assert.equal((await limited.post('/api/v1/staff/payments').send({ booking_id: 1, amount: 1, payment_method: 'CASH' })).status, 403, 'missing collect_payment permission');
    assert.equal((await h.request(app).get('/api/v1/bookings/my')).status, 401);
  });
});

describe('availability & booking engine', () => {
  test('pay-at-hotel booking is confirmed, priced on the server, and reduces availability', async () => {
    const rt = await h.makeRoomType({ price: 1000, rooms: 2 });
    const c = await h.login(app, await h.makeUser());
    const body = { ...h.bookingBody(rt, { inDays: 5, nights: 2 }), total_amount: 1, subtotal: 1 }; // tampered client values
    const res = await c.post('/api/v1/bookings').send(body);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const b = res.body.booking;
    assert.equal(b.booking_status, 'CONFIRMED');
    assert.equal(b.payment_status, 'PENDING');
    assert.equal(b.subtotal, 2000);
    assert.equal(b.taxes, 240);
    assert.equal(b.total_amount, 2240, 'client-sent totals are ignored');
    assert.match(b.booking_reference, /^SE-[A-Z2-9]{8}$/);

    const av = await h.request(app).get(`/api/v1/rooms/availability?check_in=${h.day(5)}&check_out=${h.day(7)}&adults=2&rooms=1`);
    assert.equal(av.body.items.find((i) => i.id === rt.id).available_rooms, 1);
    // Non-overlapping stay (check-in on the previous guest's check-out day) is unaffected.
    const av2 = await h.request(app).get(`/api/v1/rooms/availability?check_in=${h.day(7)}&check_out=${h.day(8)}&adults=2&rooms=1`);
    assert.equal(av2.body.items.find((i) => i.id === rt.id).available_rooms, 2);
  });

  test('simultaneous bookings never double-book (2 rooms, 8 concurrent requests)', async () => {
    const rt = await h.makeRoomType({ rooms: 2 });
    const clients = await Promise.all(Array.from({ length: 8 }, async () => h.login(app, await h.makeUser())));
    const results = await Promise.all(clients.map((c) => c.post('/api/v1/bookings').send(h.bookingBody(rt, { inDays: 10, nights: 3 }))));
    const ok = results.filter((r) => r.status === 201);
    const conflict = results.filter((r) => r.status === 409);
    assert.equal(ok.length, 2, `statuses: ${results.map((r) => r.status)}`);
    assert.equal(conflict.length, 6);
    const lines = await h.prisma().bookingRoom.findMany({ where: { roomTypeId: rt.id } });
    assert.equal(new Set(lines.map((l) => l.roomId)).size, 2, 'each booking got a distinct physical room');
  });

  test('multi-room bookings are atomic', async () => {
    const rt = await h.makeRoomType({ rooms: 2 });
    const c = await h.login(app, await h.makeUser());
    const tooMany = await c.post('/api/v1/bookings').send(h.bookingBody(rt, { qty: 3, adults: 3, inDays: 12 }));
    assert.equal(tooMany.status, 409);
    assert.equal(await h.prisma().booking.count({ where: { rooms: { some: { roomTypeId: rt.id } } } }), 0, 'nothing partially reserved');
    const two = await c.post('/api/v1/bookings').send(h.bookingBody(rt, { qty: 2, adults: 3, children: 1, inDays: 12 }));
    assert.equal(two.status, 201);
    assert.equal(two.body.booking.rooms.length, 2);
    assert.equal(two.body.booking.rooms.reduce((s, r) => s + r.adults + r.children, 0), 4, 'guests distributed across rooms');
  });

  test('validates dates and capacity', async () => {
    const rt = await h.makeRoomType({ rooms: 1, maxAdults: 2, maxChildren: 0 });
    const c = await h.login(app, await h.makeUser());
    assert.equal((await c.post('/api/v1/bookings').send(h.bookingBody(rt, { inDays: -1 }))).status, 400, 'past check-in');
    assert.equal((await c.post('/api/v1/bookings').send({ ...h.bookingBody(rt), check_out: h.day(3) })).status, 400, 'check-out not after check-in');
    assert.equal((await c.post('/api/v1/bookings').send(h.bookingBody(rt, { adults: 3 }))).status, 400, 'over capacity');
  });

  test('unverified customers cannot book', async () => {
    const rt = await h.makeRoomType({ rooms: 1 });
    const c = await h.login(app, await h.makeUser('CUSTOMER', { emailVerifiedAt: null }));
    const r = await c.post('/api/v1/bookings').send(h.bookingBody(rt));
    assert.equal(r.status, 403);
    assert.equal(r.body.error.code, 'EMAIL_NOT_VERIFIED');
  });

  test('customers cannot see other customers\' bookings', async () => {
    const rt = await h.makeRoomType({ rooms: 1 });
    const a = await h.login(app, await h.makeUser());
    const b = await h.login(app, await h.makeUser());
    const res = await a.post('/api/v1/bookings').send(h.bookingBody(rt, { inDays: 20 }));
    assert.equal((await b.get(`/api/v1/bookings/${res.body.booking.id}`)).status, 404);
    assert.equal((await a.get(`/api/v1/bookings/${res.body.booking.id}`)).status, 200);
  });

  test('coupons are validated, applied and usage-limited', async () => {
    const rt = await h.makeRoomType({ price: 5000, rooms: 3 });
    await h.prisma().coupon.create({ data: { code: 'TEN', discountType: 'PERCENTAGE', discountValue: '10', minimumAmount: '1000', maximumDiscount: '700', usageLimit: 1, startDate: new Date(Date.now() - 864e5 * 2), endDate: new Date(Date.now() + 864e5 * 30) } });
    const c = await h.login(app, await h.makeUser());
    const q = await c.post('/api/v1/bookings/quote').send({ ...h.bookingBody(rt, { inDays: 30 }), coupon_code: 'ten' });
    assert.equal(q.status, 200, JSON.stringify(q.body));
    assert.equal(q.body.discount, 700, '10% of 10,000 capped at 700');
    assert.equal(q.body.total, Math.round((10000 - 700) * 1.12 * 100) / 100);
    assert.equal((await c.post('/api/v1/bookings').send(h.bookingBody(rt, { inDays: 30, coupon: 'TEN' }))).status, 201);
    const again = await c.post('/api/v1/bookings').send(h.bookingBody(rt, { inDays: 30, coupon: 'TEN' }));
    assert.equal(again.status, 400);
    assert.match(again.body.error.message, /usage limit/);
  });
});

describe('online payments', () => {
  test('hold → checkout → signed webhook confirms; replay is idempotent; bad signature rejected', async () => {
    const rt = await h.makeRoomType({ price: 1500, rooms: 1 });
    const c = await h.login(app, await h.makeUser());
    const res = await c.post('/api/v1/bookings').send(h.bookingBody(rt, { method: 'ONLINE', inDays: 40 }));
    assert.equal(res.status, 201);
    const b = res.body.booking;
    assert.equal(b.booking_status, 'PENDING_PAYMENT');
    assert.ok(b.expires_at);

    const co = await c.post('/api/v1/payments/checkout').send({ booking_id: b.id });
    assert.equal(co.status, 201, JSON.stringify(co.body));
    const sessionId = new URL(co.body.checkout_url).searchParams.get('session');
    const again = await c.post('/api/v1/payments/checkout').send({ booking_id: b.id });
    assert.equal(again.body.payment_id, co.body.payment_id, 're-requesting checkout reuses the pending session');

    // Forged webhook without a valid signature is rejected.
    const forged = JSON.stringify({ id: 'evt_forged', type: 'checkout.paid', data: { session_id: sessionId, amount: b.total_amount } });
    const bad = await h.request(app).post('/api/v1/payments/webhook').set('content-type', 'application/json').set('x-mock-signature', 't=1,v1=deadbeef').send(forged);
    assert.equal(bad.status, 400);
    assert.equal((await c.get(`/api/v1/bookings/${b.id}`)).body.booking.booking_status, 'PENDING_PAYMENT', 'browser/forged calls cannot confirm');

    // Properly signed webhook (as the provider would send).
    const mock = require('../src/services/payments/mock.provider');
    const evt = mock.buildEvent({ sessionId, outcome: 'paid', method: 'GCASH', amount: b.total_amount });
    const ok = await h.request(app).post('/api/v1/payments/webhook').set('content-type', 'application/json').set(evt.headers).send(evt.raw);
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    let after = (await c.get(`/api/v1/bookings/${b.id}`)).body.booking;
    assert.equal(after.booking_status, 'CONFIRMED');
    assert.equal(after.payment_status, 'PAID');
    assert.equal(after.amount_paid, b.total_amount);

    const replay = await h.request(app).post('/api/v1/payments/webhook').set('content-type', 'application/json').set(evt.headers).send(evt.raw);
    assert.equal(replay.body.duplicate, true);
    after = (await c.get(`/api/v1/bookings/${b.id}`)).body.booking;
    assert.equal(after.amount_paid, b.total_amount, 'replayed event does not double-count');
  });

  test('expired holds release inventory; late payment re-confirms only if rooms are still free', async () => {
    const rt = await h.makeRoomType({ rooms: 1 });
    const c = await h.login(app, await h.makeUser());
    const b = (await c.post('/api/v1/bookings').send(h.bookingBody(rt, { method: 'ONLINE', inDays: 50 }))).body.booking;
    const co = await c.post('/api/v1/payments/checkout').send({ booking_id: b.id });
    const sessionId = new URL(co.body.checkout_url).searchParams.get('session');

    await h.prisma().booking.update({ where: { id: b.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const bookings = require('../src/services/booking.service');
    assert.equal(await bookings.expireHolds(), 1);
    assert.equal((await c.get(`/api/v1/bookings/${b.id}`)).body.booking.booking_status, 'EXPIRED');

    const other = await h.login(app, await h.makeUser());
    const taken = await other.post('/api/v1/bookings').send(h.bookingBody(rt, { inDays: 50 }));
    assert.equal(taken.status, 201, 'released room is bookable again');

    const mock = require('../src/services/payments/mock.provider');
    const evt = mock.buildEvent({ sessionId, outcome: 'paid', method: 'CARD', amount: b.total_amount });
    await h.request(app).post('/api/v1/payments/webhook').set('content-type', 'application/json').set(evt.headers).send(evt.raw);
    const late = (await c.get(`/api/v1/bookings/${b.id}`)).body.booking;
    assert.equal(late.booking_status, 'EXPIRED', 'not confirmed because the room was re-booked');
    assert.equal(late.payment_status, 'PAID', 'payment recorded so it can be refunded');
    const alerts = await h.prisma().auditLog.count({ where: { action: 'PAYMENT_ALERT' } });
    assert.ok(alerts >= 1, 'admins alerted to refund');
  });
});

describe('front desk, cancellations, refunds, reviews, reports', () => {
  test('check-in → balance blocks check-out → collect payment → check-out marks rooms dirty → review', async () => {
    const rt = await h.makeRoomType({ price: 2000, rooms: 1 });
    const cust = await h.makeUser();
    const c = await h.login(app, cust);
    const b = (await c.post('/api/v1/bookings').send(h.bookingBody(rt, { inDays: 0, nights: 1 }))).body.booking;
    const s = await h.login(app, await h.makeUser('RECEPTIONIST'));

    assert.equal((await c.post('/api/v1/reviews').send({ booking_id: b.id, rating: 5 })).status, 409, 'cannot review before stay');
    const ci = await s.post(`/api/v1/staff/bookings/${b.id}/check-in`).send({});
    assert.equal(ci.status, 200, JSON.stringify(ci.body));
    assert.equal(ci.body.booking.booking_status, 'CHECKED_IN');

    const blocked = await s.post(`/api/v1/staff/bookings/${b.id}/check-out`).send({});
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.error.code, 'BALANCE_DUE');

    const over = await s.post('/api/v1/staff/payments').send({ booking_id: b.id, amount: 999999, payment_method: 'CASH' });
    assert.equal(over.status, 400, 'cannot collect more than the balance');
    const pay = await s.post('/api/v1/staff/payments').send({ booking_id: b.id, amount: b.total_amount, payment_method: 'CASH' });
    assert.equal(pay.status, 201);
    assert.equal(pay.body.booking.payment_status, 'PAID');

    const co = await s.post(`/api/v1/staff/bookings/${b.id}/check-out`).send({});
    assert.equal(co.status, 200);
    const room = await h.prisma().room.findFirst({ where: { roomTypeId: rt.id } });
    assert.equal(room.housekeepingStatus, 'DIRTY');

    const pdf = await c.get(`/api/v1/bookings/${b.id}/receipt`);
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers['content-type'], 'application/pdf');

    assert.equal((await c.post('/api/v1/reviews').send({ booking_id: b.id, rating: 5, comment: 'Great' })).status, 201);
    assert.equal((await c.post('/api/v1/reviews').send({ booking_id: b.id, rating: 4 })).status, 409, 'one review per booking');
  });

  test('room reassignment refuses rooms that are already taken', async () => {
    const rt = await h.makeRoomType({ rooms: 2 });
    const c1 = await h.login(app, await h.makeUser());
    const c2 = await h.login(app, await h.makeUser());
    const b1 = (await c1.post('/api/v1/bookings').send(h.bookingBody(rt, { inDays: 60 }))).body.booking;
    const b2 = (await c2.post('/api/v1/bookings').send(h.bookingBody(rt, { inDays: 61 }))).body.booking;
    const s = await h.login(app, await h.makeUser('RECEPTIONIST'));
    const r = await s.post(`/api/v1/staff/bookings/${b1.id}/assign-room`).send({ booking_room_id: b1.rooms[0].id, room_id: b2.rooms[0].room_id });
    assert.equal(r.status, 409);
  });

  test('unpaid cancellation is immediate; paid cancellation is reviewed and refunded', async () => {
    const rt = await h.makeRoomType({ price: 1000, rooms: 2 });
    const c = await h.login(app, await h.makeUser());
    const unpaid = (await c.post('/api/v1/bookings').send(h.bookingBody(rt, { inDays: 70 }))).body.booking;
    const r1 = await c.post(`/api/v1/bookings/${unpaid.id}/cancel`).send({ reason: 'Plans changed' });
    assert.equal(r1.body.result, 'CANCELLED');

    const paid = (await c.post('/api/v1/bookings').send(h.bookingBody(rt, { method: 'ONLINE', inDays: 70 }))).body.booking;
    const co = await c.post('/api/v1/payments/checkout').send({ booking_id: paid.id });
    const sid = new URL(co.body.checkout_url).searchParams.get('session');
    const done = await c.post(`/api/v1/payments/mock/sessions/${sid}/complete`).send({ outcome: 'paid', method: 'MAYA' });
    assert.equal(done.status, 200, JSON.stringify(done.body));
    const r2 = await c.post(`/api/v1/bookings/${paid.id}/cancel`).send({ reason: 'Flight cancelled' });
    assert.equal(r2.body.result, 'REQUESTED');
    assert.equal(r2.body.booking.booking_status, 'CONFIRMED', 'still holds the room until reviewed');

    const a = await h.login(app, await h.makeUser('ADMIN'));
    const tooMuch = await a.post(`/api/v1/admin/bookings/${paid.id}/cancellation-review`).send({ approve: true, refund_amount: paid.total_amount + 1 });
    assert.equal(tooMuch.status, 400);
    const ok = await a.post(`/api/v1/admin/bookings/${paid.id}/cancellation-review`).send({ approve: true, refund_amount: paid.total_amount, note: 'Approved' });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.booking.booking_status, 'CANCELLED');
    assert.equal(ok.body.booking.payment_status, 'REFUNDED');
    assert.equal(ok.body.booking.amount_refunded, paid.total_amount);
  });

  test('admin dashboard and reports use live data; PDF and Excel export', async () => {
    const a = await h.login(app, await h.makeUser('ADMIN'));
    const d = await a.get('/api/v1/admin/dashboard');
    assert.equal(d.status, 200);
    assert.ok(d.body.stats.total_reservations > 0);
    assert.ok(d.body.stats.total_revenue > 0);
    assert.ok(Array.isArray(d.body.charts.daily_revenue.data));
    for (const name of ['revenue', 'occupancy', 'bookings', 'payments', 'cancellations', 'customers', 'checkins', 'checkouts']) {
      const r = await a.get(`/api/v1/admin/reports/${name}?from=${h.day(-5)}&to=${h.day(5)}`);
      assert.equal(r.status, 200, `${name}: ${JSON.stringify(r.body)}`);
      assert.ok(Array.isArray(r.body.rows));
    }
    const pdf = await a.get(`/api/v1/admin/reports/revenue?format=pdf&group=week`);
    assert.equal(pdf.headers['content-type'], 'application/pdf');
    assert.ok(pdf.body.length > 1000);
    const xlsx = await a.get(`/api/v1/admin/reports/bookings?format=xlsx`).buffer(true).parse((res, cb) => { const ch = []; res.on('data', (x) => ch.push(x)); res.on('end', () => cb(null, Buffer.concat(ch))); });
    assert.match(xlsx.headers['content-type'], /spreadsheetml/);
    assert.equal(xlsx.body.slice(0, 2).toString(), 'PK', 'valid xlsx (zip) file');
    const logs = await a.get('/api/v1/admin/audit-logs');
    assert.ok(logs.body.items.some((l) => l.action === 'CANCELLATION_APPROVED'));
  });
});
