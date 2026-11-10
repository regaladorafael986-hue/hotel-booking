const bookings = require('../services/booking.service');
const payments = require('../services/payment.service');
const rooms = require('../services/room.service');
const users = require('../services/user.service');
const dashboard = require('../services/dashboard.service');
const { hotelToday, addDays, formatDate } = require('../utils/dates');
const prisma = require('../config/prisma');

module.exports = {
  async dashboard(req, res) {
    const today = hotelToday();
    const [stats, arrivals, departures, inHouse, upcoming, roomList] = await Promise.all([
      dashboard.stats(),
      bookings.arrivals(req.user),
      bookings.departures(req.user),
      bookings.inHouse(req.user),
      prisma.booking.findMany({ where: { checkIn: { gt: today, lte: addDays(today, 7) }, bookingStatus: { in: ['CONFIRMED', 'PENDING_CONFIRMATION'] } }, include: bookings.include, orderBy: { checkIn: 'asc' }, take: 20 }),
      rooms.list({ active: 'true' }),
    ]);
    const hk = roomList.reduce((m, r) => ({ ...m, [r.housekeeping_status]: (m[r.housekeeping_status] || 0) + 1 }), {});
    res.json({
      date: formatDate(today),
      stats: { occupied_rooms: stats.occupied_rooms, physical_rooms: stats.physical_rooms, available_rooms: stats.available_rooms, occupancy_rate: stats.occupancy_rate, arrivals: arrivals.length, arrivals_pending: arrivals.filter((b) => b.booking_status !== 'CHECKED_IN').length, departures: departures.length, departures_pending: departures.filter((b) => b.booking_status === 'CHECKED_IN').length, in_house: inHouse.length, housekeeping: hk },
      arrivals, departures, in_house: inHouse,
      upcoming: upcoming.map((b) => bookings.present(b, null, req.user)),
    });
  },

  async arrivals(req, res) {
    res.json({ items: await bookings.arrivals(req.user, req.query.date) });
  },
  async departures(req, res) {
    res.json({ items: await bookings.departures(req.user, req.query.date) });
  },
  async inHouse(req, res) {
    res.json({ items: await bookings.inHouse(req.user) });
  },

  async search(req, res) {
    res.json(await bookings.listAdmin(req.user, { ...req.q, page_size: req.q?.page_size || 15 }));
  },
  async getBooking(req, res) {
    res.json({ booking: await bookings.getById(req.user, req.params.id) });
  },
  async findByReference(req, res) {
    const ref = String(req.params.ref || '').toUpperCase();
    const b = await prisma.booking.findUnique({ where: { bookingReference: ref }, select: { id: true } });
    if (!b) return res.status(404).json({ error: { message: `No booking found with reference ${ref}.`, code: 'NOT_FOUND' } });
    res.json({ booking: await bookings.getById(req.user, b.id) });
  },

  async checkIn(req, res) {
    res.json({ booking: await bookings.checkIn(req, req.params.id, req.body || {}), message: 'Guest checked in.' });
  },
  async checkOut(req, res) {
    res.json({ booking: await bookings.checkOut(req, req.params.id), message: 'Guest checked out.' });
  },
  async assignableRooms(req, res) {
    res.json({ items: await bookings.assignableRooms(req.params.id, Number(req.query.booking_room_id)) });
  },
  async assignRoom(req, res) {
    res.json({ booking: await bookings.assignRoom(req, req.params.id, req.body), message: 'Room assigned.' });
  },
  async recordPayment(req, res) {
    const payment = await payments.recordFrontDeskPayment(req, req.body);
    res.status(201).json({ payment, booking: await bookings.getById(req.user, req.body.booking_id), message: 'Payment recorded.' });
  },
  async walkIn(req, res) {
    const { booking, warnings } = await bookings.walkIn(req, req.body);
    res.status(201).json({ booking, warnings, message: warnings.length ? `Reservation created. ${warnings.join(' ')}` : 'Walk-in reservation created.' });
  },
  async confirm(req, res) {
    res.json({ booking: await bookings.adminSetStatus(req, req.params.id, { status: 'CONFIRMED' }), message: 'Reservation confirmed.' });
  },

  async rooms(req, res) {
    res.json({ items: await rooms.list(req.query) });
  },
  async housekeeping(req, res) {
    res.json({ room: await rooms.setHousekeeping(req, req.params.id, req.body.housekeeping_status, req.body.notes), message: 'Room status updated.' });
  },
  async customerLookup(req, res) {
    res.json({ items: await users.searchCustomersLite(String(req.query.q || '').trim()) });
  },
};
