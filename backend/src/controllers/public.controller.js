const hotel = require('../services/hotel.service');
const roomTypes = require('../services/roomType.service');
const amenities = require('../services/amenity.service');
const availability = require('../services/availability.service');
const pricing = require('../services/pricing.service');
const coupons = require('../services/coupon.service');
const reviews = require('../services/review.service');
const { hotelToday, formatDate } = require('../utils/dates');
const AppError = require('../utils/AppError');
const prisma = require('../config/prisma');
const env = require('../config/env');
const email = require('../services/email.service');
const audit = require('../services/audit.service');

module.exports = {
  async hotelInfo(req, res) {
    res.json(await hotel.getPublicInfo());
  },

  async listRooms(req, res) {
    res.json({ items: await roomTypes.listPublic(req.q) });
  },

  async getRoom(req, res) {
    res.json(await roomTypes.getPublic(req.params.id));
  },

  async filters(req, res) {
    const [bedTypes, amenityList] = await Promise.all([roomTypes.bedTypes(), amenities.list()]);
    res.json({ bed_types: bedTypes, amenities: amenityList.filter((a) => a.room_type_count > 0).map(({ room_type_count, ...a }) => a) });
  },

  /** Date-based search: only categories with enough free physical rooms for the request are returned. */
  async availability(req, res) {
    const q = req.q;
    const { checkIn, checkOut, nights } = pricing.validateStay(q.check_in, q.check_out);
    const guests = q.adults + q.children;
    let types = await roomTypes.listPublic({ min_price: q.min_price, max_price: q.max_price, bed_type: q.bed_type, amenities: q.amenities, capacity: q.capacity });
    if (q.room_type_id) types = types.filter((t) => t.id === q.room_type_id);
    const counts = await availability.countAvailable(prisma, { checkIn, checkOut, roomTypeIds: types.map((t) => t.id) });
    const items = types
      .map((t) => {
        const c = counts.get(t.id) || { total: 0, available: 0 };
        return { ...t, available_rooms: c.available, total_rooms: c.total, nights, stay_price: Number((t.base_price * nights * q.rooms).toFixed(2)) };
      })
      .filter((t) => t.available_rooms >= q.rooms && t.max_adults * q.rooms >= q.adults && t.max_guests * q.rooms >= guests && q.rooms <= q.adults);
    res.json({ search: { check_in: q.check_in, check_out: q.check_out, nights, adults: q.adults, children: q.children, rooms: q.rooms }, items });
  },

  async calendar(req, res) {
    const month = req.q.month || formatDate(hotelToday()).slice(0, 7);
    const room = await roomTypes.getPublic(req.params.id);
    res.json({ room_type_id: room.id, month, days: await availability.calendar(room.id, month) });
  },

  /** Price preview (server-calculated). Used by the booking page to show totals and validate promo codes. */
  async quote(req, res) {
    const q = await pricing.quote(req.body);
    const counts = await availability.countAvailable(prisma, { checkIn: q.checkIn, checkOut: q.checkOut, roomTypeIds: q.lines.map((l) => l.room_type_id) });
    const shortages = q.lines.filter((l) => (counts.get(l.room_type_id)?.available || 0) < l.quantity).map((l) => ({ room_type_id: l.room_type_id, name: l.name, available: counts.get(l.room_type_id)?.available || 0 }));
    if (shortages.length) throw AppError.conflict(`${shortages[0].name} has only ${shortages[0].available} room(s) left for those dates.`, { shortages });
    res.json(q.public);
  },

  /** Website contact form → emailed to the hotel's reservations address. */
  async contact(req, res) {
    const settings = await hotel.getSettings();
    const to = settings.email || env.brevo.fromEmail;
    const result = await email.send('contactMessage', to, req.body, settings.hotelName);
    await audit.log(req, 'CONTACT_MESSAGE', { entityType: 'contact', description: `${req.body.email}: ${req.body.subject}` });
    if (result.error) throw new AppError(502, 'We could not send your message right now. Please call or email us directly.');
    res.status(201).json({ message: 'Thank you — your message has been sent. We usually reply within one business day.' });
  },

  async offers(req, res) {
    res.json({ items: await coupons.publicOffers() });
  },

  async reviews(req, res) {
    res.json(await reviews.listPublic(req.query));
  },
};
