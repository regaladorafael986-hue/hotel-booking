// Physical rooms. Availability is NEVER read from a static field here — see availability.service.js.
const prisma = require('../config/prisma');
const AppError = require('../utils/AppError');
const { serialize } = require('../utils/serialize');
const { hotelToday } = require('../utils/dates');
const audit = require('./audit.service');
const { ACTIVE_STATUSES } = require('./availability.service');

/** Upcoming/current active reservations that hold this physical room. */
async function upcomingAssignments(roomId) {
  return prisma.bookingRoom.findMany({
    where: {
      roomId,
      booking: {
        checkOut: { gt: hotelToday() },
        OR: [{ bookingStatus: { in: ACTIVE_STATUSES.filter((s) => s !== 'PENDING_PAYMENT') } }, { bookingStatus: 'PENDING_PAYMENT', expiresAt: { gt: new Date() } }],
      },
    },
    include: { booking: { select: { bookingReference: true, checkIn: true, checkOut: true, bookingStatus: true } } },
  });
}

async function occupancyMap(roomIds) {
  const today = hotelToday();
  const rows = await prisma.bookingRoom.findMany({
    where: { roomId: { in: roomIds }, booking: { bookingStatus: 'CHECKED_IN' } },
    include: { booking: { select: { id: true, bookingReference: true, guestFirstName: true, guestLastName: true, checkOut: true } } },
  });
  const arriving = await prisma.bookingRoom.findMany({
    where: { roomId: { in: roomIds }, booking: { checkIn: today, bookingStatus: { in: ['CONFIRMED', 'PENDING_CONFIRMATION'] } } },
    include: { booking: { select: { id: true, bookingReference: true, guestFirstName: true, guestLastName: true } } },
  });
  const map = new Map();
  for (const r of rows) map.set(r.roomId, { occupancy: 'OCCUPIED', booking: serialize(r.booking) });
  for (const r of arriving) if (!map.has(r.roomId)) map.set(r.roomId, { occupancy: 'ARRIVING_TODAY', booking: serialize(r.booking) });
  return map;
}

async function list(q = {}) {
  const where = {};
  if (q.room_type_id) where.roomTypeId = Number(q.room_type_id);
  if (q.status) where.housekeepingStatus = q.status;
  if (q.active === 'true') where.isActive = true;
  if (q.active === 'false') where.isActive = false;
  if (q.q) where.roomNumber = { contains: q.q };
  const rooms = await prisma.room.findMany({ where, include: { roomType: { select: { id: true, name: true, status: true } } }, orderBy: [{ floor: 'asc' }, { roomNumber: 'asc' }] });
  const occ = await occupancyMap(rooms.map((r) => r.id));
  return rooms.map((r) => ({ ...serialize(r), occupancy: occ.get(r.id)?.occupancy || (r.isActive ? 'VACANT' : 'INACTIVE'), current_booking: occ.get(r.id)?.booking || null }));
}

async function get(id) {
  const room = await prisma.room.findUnique({ where: { id }, include: { roomType: true } });
  if (!room) throw AppError.notFound('Room not found.');
  return serialize(room);
}

async function create(req, d) {
  const type = await prisma.roomType.findUnique({ where: { id: d.room_type_id } });
  if (!type) throw AppError.badRequest('Selected room category does not exist.', { fields: { room_type_id: 'Invalid category.' } });
  const room = await prisma.room.create({
    data: { roomTypeId: d.room_type_id, roomNumber: d.room_number.toUpperCase(), floor: d.floor, housekeepingStatus: d.housekeeping_status || 'CLEAN', isActive: d.is_active ?? true, notes: d.notes || null },
  });
  await audit.log(req, 'ROOM_CREATED', { entityType: 'room', entityId: room.id, description: `Room ${room.roomNumber} (${type.name})` });
  return get(room.id);
}

async function guardTakingOutOfService(roomId, action) {
  const holds = await upcomingAssignments(roomId);
  if (holds.length) {
    const refs = holds.map((h) => h.booking.bookingReference).join(', ');
    throw AppError.conflict(`Cannot ${action}: the room is assigned to upcoming reservation(s) ${refs}. Reassign them to another room first.`, { bookings: refs });
  }
}

async function update(req, id, d) {
  const room = await prisma.room.findUnique({ where: { id } });
  if (!room) throw AppError.notFound('Room not found.');
  if (d.is_active === false && room.isActive) await guardTakingOutOfService(id, 'deactivate this room');
  if (d.housekeeping_status === 'MAINTENANCE' && room.housekeepingStatus !== 'MAINTENANCE') await guardTakingOutOfService(id, 'mark this room under maintenance');
  if (d.room_type_id && d.room_type_id !== room.roomTypeId) await guardTakingOutOfService(id, 'move this room to another category');
  const updated = await prisma.room.update({
    where: { id },
    data: {
      roomTypeId: d.room_type_id ?? undefined,
      roomNumber: d.room_number ? d.room_number.toUpperCase() : undefined,
      floor: d.floor ?? undefined,
      housekeepingStatus: d.housekeeping_status ?? undefined,
      isActive: d.is_active ?? undefined,
      notes: d.notes === undefined ? undefined : d.notes || null,
    },
  });
  await audit.log(req, 'ROOM_UPDATED', { entityType: 'room', entityId: id, description: `Room ${updated.roomNumber}: ${Object.keys(d).join(', ')}` });
  return get(id);
}

async function setHousekeeping(req, id, status, notes) {
  const room = await prisma.room.findUnique({ where: { id } });
  if (!room) throw AppError.notFound('Room not found.');
  if (status === 'MAINTENANCE' && room.housekeepingStatus !== 'MAINTENANCE') await guardTakingOutOfService(id, 'mark this room under maintenance');
  await prisma.room.update({ where: { id }, data: { housekeepingStatus: status, ...(notes !== undefined ? { notes: notes || null } : {}) } });
  await audit.log(req, 'HOUSEKEEPING_UPDATED', { entityType: 'room', entityId: id, description: `Room ${room.roomNumber}: ${room.housekeepingStatus} → ${status}` });
  return get(id);
}

/** Rooms are deactivated rather than deleted once they have any booking history. */
async function remove(req, id) {
  const room = await prisma.room.findUnique({ where: { id }, include: { _count: { select: { bookingRooms: true } } } });
  if (!room) throw AppError.notFound('Room not found.');
  if (room._count.bookingRooms > 0) {
    await guardTakingOutOfService(id, 'deactivate this room');
    await prisma.room.update({ where: { id }, data: { isActive: false } });
    await audit.log(req, 'ROOM_DEACTIVATED', { entityType: 'room', entityId: id, description: `Room ${room.roomNumber} has booking history; deactivated instead of deleted` });
    return { deactivated: true };
  }
  await prisma.room.delete({ where: { id } });
  await audit.log(req, 'ROOM_DELETED', { entityType: 'room', entityId: id, description: `Room ${room.roomNumber}` });
  return { deleted: true };
}

module.exports = { list, get, create, update, setHousekeeping, remove, upcomingAssignments };
