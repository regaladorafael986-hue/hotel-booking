// Test harness: points Prisma at a separate database (stayease_test), resets it, and builds fixtures.
const path = require('path');
const { execSync } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const base = process.env.DATABASE_URL || 'mysql://root:@localhost:3306/stayease_db';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || base.replace(/\/[^/?]+(\?|$)/, '/stayease_test$1');
process.env.NODE_ENV = 'test';
process.env.PAYMENT_PROVIDER = 'mock';
process.env.RUN_JOBS = 'false';
process.env.REQUIRE_EMAIL_VERIFICATION_FOR_BOOKING = 'true';

const request = require('supertest');
const bcrypt = require('bcryptjs');

let migrated = false;
function migrate() {
  if (migrated) return;
  execSync('npx prisma migrate deploy', { cwd: path.join(__dirname, '..'), env: process.env, stdio: 'pipe' });
  migrated = true;
}

const prisma = () => require('../src/config/prisma');
const { createApp } = require('../src/app');
const { hotelToday, addDays, formatDate } = require('../src/utils/dates');

async function reset() {
  migrate();
  const db = prisma();
  for (const t of ['paymentEvent', 'refund', 'payment', 'review', 'notification', 'bookingRoom', 'booking', 'coupon', 'roomTypeAmenity', 'roomImage', 'room', 'roomType', 'amenity', 'hotelImage', 'hotelSettings', 'auditLog', 'authToken', 'session', 'user']) {
    await db[t].deleteMany();
  }
  await db.hotelSettings.create({ data: { hotelName: 'Test Hotel', taxRate: '12.00', holdMinutes: 15, payAtHotelAutoConfirm: true, freeCancellationHours: 48 } });
}

const PW = 'Passw0rd!x';
const HASH = bcrypt.hashSync(PW, 4);
let seq = 0;
async function makeUser(role = 'CUSTOMER', extra = {}) {
  seq++;
  return prisma().user.create({ data: { firstName: `U${seq}`, lastName: role, email: `u${seq}.${Date.now()}@test.dev`, passwordHash: HASH, role, emailVerifiedAt: new Date(), ...extra } });
}

/** One room category with `rooms` physical rooms. */
async function makeRoomType({ name = `Type ${++seq}`, price = 1000, rooms = 2, maxAdults = 2, maxChildren = 1 } = {}) {
  const rt = await prisma().roomType.create({ data: { name, slug: name.toLowerCase().replace(/\s+/g, '-'), basePrice: price.toFixed(2), maxAdults, maxChildren, bedType: 'Queen bed' } });
  for (let i = 1; i <= rooms; i++) await prisma().room.create({ data: { roomTypeId: rt.id, roomNumber: `${rt.id}${String(i).padStart(2, '0')}`, floor: 1 } });
  return rt;
}

/** Logged-in supertest agent with CSRF header helper. */
async function login(app, user) {
  const agent = request.agent(app);
  const token = await csrf(agent); // must resolve before the request is created (agent attaches cookies at creation)
  const res = await agent.post('/api/v1/auth/login').set('x-csrf-token', token).send({ email: user.email, password: PW });
  if (res.status !== 200) throw new Error(`login failed ${res.status} ${JSON.stringify(res.body)}`);
  agent.token = res.body.csrf_token;
  const wrap = (m) => (url) => agent[m](url).set('x-csrf-token', agent.token);
  return { agent, get: (u) => agent.get(u), post: wrap('post'), put: wrap('put'), del: wrap('delete'), user };
}
async function csrf(agent) {
  const r = await agent.get('/api/v1/auth/csrf');
  return r.body.csrf_token;
}

const day = (n) => formatDate(addDays(hotelToday(), n));
const bookingBody = (rt, { inDays = 3, nights = 2, qty = 1, adults = 2, children = 0, method = 'PAY_AT_HOTEL', coupon } = {}) => ({
  check_in: day(inDays), check_out: day(inDays + nights), adults, children,
  items: [{ room_type_id: rt.id, quantity: qty }],
  guest: { first_name: 'Test', last_name: 'Guest', email: 'guest@test.dev', phone: '+63 917 000 0000' },
  payment_method: method, ...(coupon ? { coupon_code: coupon } : {}),
});

module.exports = { createApp, prisma, reset, makeUser, makeRoomType, login, csrf, day, bookingBody, request, PW };
