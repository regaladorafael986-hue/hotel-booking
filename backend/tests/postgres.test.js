// PostgreSQL-specific behaviour that MySQL gave for free (or did differently): raw SQL casing and
// booleans, timestamp/time-zone handling, case-insensitive search, and duplicate-key error mapping.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const availability = require('../src/services/availability.service');
const reports = require('../src/services/report.service');
const { parseDate, addDays, hotelToday, formatDate } = require('../src/utils/dates');

let app;
before(async () => {
  await h.reset();
  app = h.createApp();
});
after(async () => { await h.prisma().$disconnect(); });

/** A PENDING_PAYMENT booking holding one specific room until `expiresAt`. */
async function hold(rt, room, { checkIn, checkOut, expiresAt }) {
  return h.prisma().booking.create({
    data: {
      bookingReference: `SE-T${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
      guestFirstName: 'Hold', guestLastName: 'Test', guestEmail: 'hold@test.dev',
      checkIn, checkOut, nights: 1, adults: 1, totalRooms: 1,
      subtotal: '1000.00', totalAmount: '1000.00',
      bookingStatus: 'PENDING_PAYMENT', paymentMethod: 'ONLINE', expiresAt,
      rooms: { create: [{ roomId: room.id, roomTypeId: rt.id, nightlyRate: '1000.00', adults: 1 }] },
    },
  });
}

describe('postgresql compatibility', () => {
  test('availability raw SQL returns camelCase columns and filters boolean is_active', async () => {
    const rt = await h.makeRoomType({ name: 'PG Casing', rooms: 3 });
    const rooms = await h.prisma().room.findMany({ where: { roomTypeId: rt.id }, orderBy: { id: 'asc' } });
    await h.prisma().room.update({ where: { id: rooms[2].id }, data: { isActive: false } });
    const checkIn = parseDate(h.day(30));
    const checkOut = parseDate(h.day(31));

    const counts = await availability.countAvailable(h.prisma(), { checkIn, checkOut, roomTypeIds: [rt.id] });
    assert.deepEqual(counts.get(rt.id), { total: 2, available: 2 }, 'inactive room excluded, map keyed by roomTypeId');

    const free = await availability.findFreeRooms(h.prisma(), { roomTypeId: rt.id, checkIn, checkOut });
    assert.equal(free.length, 2);
    assert.equal(typeof free[0].roomNumber, 'string', 'roomNumber alias survives PostgreSQL lower-casing');
    assert.equal(free[0].housekeepingStatus, 'CLEAN');
  });

  test('hold expiry compares timestamps correctly even when the server time zone is not UTC', async () => {
    const rt = await h.makeRoomType({ name: 'PG Holds', rooms: 2 });
    const [r1, r2] = await h.prisma().room.findMany({ where: { roomTypeId: rt.id }, orderBy: { id: 'asc' } });
    const checkIn = parseDate(h.day(40));
    const checkOut = parseDate(h.day(41));
    const now = new Date();
    // Expires in 2 hours: must still block. An 8-hour time-zone skew would make it look expired.
    await hold(rt, r1, { checkIn, checkOut, expiresAt: new Date(now.getTime() + 2 * 3600e3) });
    // Expired 2 hours ago: must not block. A skew the other way would make it look active.
    await hold(rt, r2, { checkIn, checkOut, expiresAt: new Date(now.getTime() - 2 * 3600e3) });

    const counts = await availability.countAvailable(h.prisma(), { checkIn, checkOut, roomTypeIds: [rt.id], now });
    assert.deepEqual(counts.get(rt.id), { total: 2, available: 1 });
    assert.equal(await availability.isRoomFree(h.prisma(), { roomId: r1.id, checkIn, checkOut, now }), false);
    assert.equal(await availability.isRoomFree(h.prisma(), { roomId: r2.id, checkIn, checkOut, now }), true);

    // Back-to-back stays: arriving on the day the held stay checks out is not an overlap.
    assert.equal(await availability.isRoomFree(h.prisma(), { roomId: r1.id, checkIn: checkOut, checkOut: parseDate(h.day(42)), now }), true);
    assert.equal(await availability.isRoomFree(h.prisma(), { roomId: r1.id, checkIn: parseDate(h.day(39)), checkOut: checkIn, now }), true);

    const month = formatDate(checkIn).slice(0, 7);
    const day = (await availability.calendar(rt.id, month)).find((d) => d.date === formatDate(checkIn));
    assert.deepEqual(day, { date: formatDate(checkIn), available: 1, total: 2 });
  });

  test('revenue is bucketed by the hotel-local (Asia/Manila) day', async () => {
    const rt = await h.makeRoomType({ name: 'PG Revenue', rooms: 1 });
    const [room] = await h.prisma().room.findMany({ where: { roomTypeId: rt.id } });
    const b = await hold(rt, room, { checkIn: parseDate(h.day(50)), checkOut: parseDate(h.day(51)), expiresAt: null });
    const d = addDays(hotelToday(), -3);
    // 17:30 UTC = 01:30 the next day in Manila (UTC+8).
    const paidAt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 17, 30));
    await h.prisma().payment.create({ data: { bookingId: b.id, paymentReference: `PAY-T${Date.now()}`, provider: 'FRONT_DESK', amount: '1234.50', paymentStatus: 'PAID', paidAt } });

    const map = await reports.dailyMoney(addDays(paidAt, -2), addDays(paidAt, 2));
    const manilaDay = formatDate(addDays(d, 1));
    assert.ok(map.has(manilaDay), `expected bucket ${manilaDay}, got ${[...map.keys()]}`);
    assert.equal(map.get(manilaDay).gross, 1234.5);
    assert.equal(map.get(manilaDay).count, 1);
  });

  test('admin search is case-insensitive (as it was on MySQL)', async () => {
    const admin = await h.makeUser('ADMIN');
    await h.makeUser('CUSTOMER', { firstName: 'Maricel', lastName: 'Dela Cruz', email: 'maricel.case@test.dev' });
    const a = await h.login(app, admin);
    for (const q of ['MARICEL', 'dela cruz', 'Maricel.Case@TEST.dev']) {
      const res = await a.get(`/api/v1/admin/customers?q=${encodeURIComponent(q)}`);
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.items.length, 1, `search "${q}"`);
    }
  });

  test('raw SQL names its schema, so it never depends on search_path (Neon pooler, shared databases)', async () => {
    // A client whose search_path points at an empty schema: any unqualified table would fail with "does not exist".
    const { PrismaClient } = require('@prisma/client');
    const url = new URL(process.env.DATABASE_URL);
    url.searchParams.set('schema', 'search_path_trap');
    const trap = new PrismaClient({ datasourceUrl: url.toString() });
    try {
      const rt = await h.makeRoomType({ name: 'PG Schema', rooms: 2 });
      const checkIn = parseDate(h.day(60));
      const checkOut = parseDate(h.day(61));
      const counts = await availability.countAvailable(trap, { checkIn, checkOut, roomTypeIds: [rt.id] });
      assert.deepEqual(counts.get(rt.id), { total: 2, available: 2 });
      const free = await availability.findFreeRooms(trap, { roomTypeId: rt.id, checkIn, checkOut });
      assert.equal(await availability.isRoomFree(trap, { roomId: free[0].id, checkIn, checkOut }), true);
      await trap.$transaction((tx) => availability.lockRoomTypes(tx, [rt.id]));
    } finally {
      await trap.$disconnect();
    }

    // Every table in every raw query in the source goes through tbl().
    const fs = require('fs');
    const path = require('path');
    const files = [];
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.js') && files.push(path.join(d, e.name))));
    walk(path.join(__dirname, '..', 'src'));
    const offenders = [];
    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8');
      for (const m of src.matchAll(/\$(?:queryRaw|executeRaw)`([\s\S]*?)`/g)) {
        for (const t of m[1].matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+(?!\$\{tbl\(|\(|SET\b)([A-Za-z_"][\w".]*)/g)) offenders.push(`${path.basename(file)}: ${t[0]}`);
      }
    }
    assert.deepEqual(offenders, [], 'unqualified tables in raw SQL');
  });

  test('duplicate unique values map to a 409 naming the field', async () => {
    const admin = await h.makeUser('ADMIN');
    const rt = await h.makeRoomType({ name: 'PG Duplicate', rooms: 1 });
    const [room] = await h.prisma().room.findMany({ where: { roomTypeId: rt.id } });
    const a = await h.login(app, admin);
    const res = await a.post('/api/v1/admin/rooms').send({ room_type_id: rt.id, room_number: room.roomNumber, floor: 1 });
    assert.equal(res.status, 409, JSON.stringify(res.body));
    assert.equal(res.body.error.code, 'DUPLICATE');
    assert.equal(res.body.error.message, 'This room number is already in use.');
    assert.ok(res.body.error.details.fields.room_number);
  });
});
