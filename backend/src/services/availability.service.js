/**
 * AVAILABILITY ENGINE
 * ───────────────────
 * Source of truth = physical rooms + the reservations that hold them (booking_rooms.room_id).
 * A room is busy for a requested stay when an *active* booking assigned to it overlaps:
 *
 *     existing.check_in < requested.check_out  AND  existing.check_out > requested.check_in
 *
 * Active = PENDING_CONFIRMATION, CONFIRMED, CHECKED_IN, or PENDING_PAYMENT whose hold has not expired.
 * Cancelled, expired and checked-out bookings never block inventory.
 * Bookable inventory = rooms that are active and not under MAINTENANCE.
 *
 * Concurrency: writers call lockRoomTypes() inside a transaction, which takes row locks
 * (SELECT … FOR UPDATE, ordered by id to avoid deadlocks) on the room_types involved.
 * Every booking/assignment for a category therefore serializes on that lock, so two guests
 * can never be given the same physical room for overlapping nights.
 */
const { Prisma } = require('@prisma/client');
const prisma = require('../config/prisma');
const { utcTimestamp, utcDate } = require('../utils/sql');
const { addDays, formatDate, parseDate } = require('../utils/dates');

const ACTIVE_STATUSES = ['PENDING_PAYMENT', 'PENDING_CONFIRMATION', 'CONFIRMED', 'CHECKED_IN'];

/** SQL fragment: booking alias `b` is holding inventory at time `now`. */
const activeBookingSql = (now) => Prisma.sql`(b.booking_status IN ('PENDING_CONFIRMATION','CONFIRMED','CHECKED_IN')
  OR (b.booking_status = 'PENDING_PAYMENT' AND b.expires_at > ${utcTimestamp(now)}))`;

async function lockRoomTypes(tx, roomTypeIds) {
  const ids = [...new Set(roomTypeIds)].sort((a, b) => a - b);
  if (!ids.length) return;
  await tx.$queryRaw`SELECT id FROM room_types WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`;
}

/**
 * Count bookable and free physical rooms per category for a stay.
 * @returns {Map<number, {total:number, available:number}>}
 */
async function countAvailable(client, { checkIn, checkOut, roomTypeIds, excludeBookingId, now = new Date() }) {
  const typeFilter = roomTypeIds?.length ? Prisma.sql`AND r.room_type_id IN (${Prisma.join(roomTypeIds)})` : Prisma.empty;
  const exclude = excludeBookingId ? Prisma.sql`AND b.id <> ${excludeBookingId}` : Prisma.empty;
  const rows = await client.$queryRaw`
    SELECT r.room_type_id AS "roomTypeId",
           COUNT(*) AS total,
           SUM(CASE WHEN busy.room_id IS NULL THEN 1 ELSE 0 END) AS available
    FROM rooms r
    JOIN room_types rt ON rt.id = r.room_type_id AND rt.status = 'ACTIVE'
    LEFT JOIN (
      SELECT DISTINCT br.room_id
      FROM booking_rooms br
      JOIN bookings b ON b.id = br.booking_id
      WHERE ${activeBookingSql(now)}
        AND b.check_in < ${utcDate(checkOut)} AND b.check_out > ${utcDate(checkIn)}
        ${exclude}
    ) busy ON busy.room_id = r.id
    WHERE r.is_active = TRUE AND r.housekeeping_status <> 'MAINTENANCE' ${typeFilter}
    GROUP BY r.room_type_id`;
  const map = new Map();
  for (const r of rows) map.set(Number(r.roomTypeId), { total: Number(r.total), available: Number(r.available) });
  return map;
}

/** Specific free physical rooms of a category for a stay (lowest floor / number first). */
async function findFreeRooms(client, { roomTypeId, checkIn, checkOut, limit = 100, excludeBookingId, now = new Date() }) {
  const exclude = excludeBookingId ? Prisma.sql`AND b.id <> ${excludeBookingId}` : Prisma.empty;
  const rows = await client.$queryRaw`
    SELECT r.id, r.room_number AS "roomNumber", r.floor, r.housekeeping_status AS "housekeepingStatus"
    FROM rooms r
    WHERE r.room_type_id = ${roomTypeId}
      AND r.is_active = TRUE AND r.housekeeping_status <> 'MAINTENANCE'
      AND NOT EXISTS (
        SELECT 1 FROM booking_rooms br JOIN bookings b ON b.id = br.booking_id
        WHERE br.room_id = r.id AND ${activeBookingSql(now)}
          AND b.check_in < ${utcDate(checkOut)} AND b.check_out > ${utcDate(checkIn)}
          ${exclude}
      )
    ORDER BY r.floor, r.room_number
    LIMIT ${limit}`;
  return rows.map((r) => ({ ...r, id: Number(r.id), floor: Number(r.floor) }));
}

/** Is a specific physical room free for a stay? */
async function isRoomFree(client, { roomId, checkIn, checkOut, excludeBookingId, now = new Date() }) {
  const exclude = excludeBookingId ? Prisma.sql`AND b.id <> ${excludeBookingId}` : Prisma.empty;
  const rows = await client.$queryRaw`
    SELECT COUNT(*) AS c FROM booking_rooms br JOIN bookings b ON b.id = br.booking_id
    WHERE br.room_id = ${roomId} AND ${activeBookingSql(now)}
      AND b.check_in < ${utcDate(checkOut)} AND b.check_out > ${utcDate(checkIn)} ${exclude}`;
  return Number(rows[0].c) === 0;
}

/**
 * Per-night availability calendar for one category over a month (for the room details page).
 * @returns {Array<{date:string, available:number, total:number}>}
 */
async function calendar(roomTypeId, month /* YYYY-MM */) {
  const start = parseDate(`${month}-01`);
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  const now = new Date();
  const total = await prisma.room.count({ where: { roomTypeId, isActive: true, housekeepingStatus: { not: 'MAINTENANCE' } } });
  const holds = await prisma.$queryRaw`
    SELECT br.room_id AS "roomId", b.check_in AS "checkIn", b.check_out AS "checkOut"
    FROM booking_rooms br JOIN bookings b ON b.id = br.booking_id
    JOIN rooms r ON r.id = br.room_id
    WHERE r.room_type_id = ${roomTypeId} AND r.is_active = TRUE AND r.housekeeping_status <> 'MAINTENANCE'
      AND ${activeBookingSql(now)} AND b.check_in < ${utcDate(end)} AND b.check_out > ${utcDate(start)}`;
  const days = [];
  for (let d = start; d < end; d = addDays(d, 1)) {
    const busy = new Set(holds.filter((h) => h.checkIn <= d && h.checkOut > d).map((h) => Number(h.roomId)));
    days.push({ date: formatDate(d), available: Math.max(0, total - busy.size), total });
  }
  return days;
}

module.exports = { ACTIVE_STATUSES, activeBookingSql, lockRoomTypes, countAvailable, findFreeRooms, isRoomFree, calendar };
