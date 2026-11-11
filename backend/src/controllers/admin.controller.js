const prisma = require('../config/prisma');
const hotel = require('../services/hotel.service');
const roomTypes = require('../services/roomType.service');
const rooms = require('../services/room.service');
const amenities = require('../services/amenity.service');
const bookings = require('../services/booking.service');
const payments = require('../services/payment.service');
const users = require('../services/user.service');
const coupons = require('../services/coupon.service');
const reviews = require('../services/review.service');
const reports = require('../services/report.service');
const exporter = require('../services/export.service');
const dashboard = require('../services/dashboard.service');
const audit = require('../services/audit.service');
const { STAFF_PERMISSIONS } = require('../middleware/auth');
const { serialize } = require('../utils/serialize');
const { getPagination, paged } = require('../utils/pagination');
const { parseDate, addDays, formatDate } = require('../utils/dates');

module.exports = {
  // Dashboard
  async dashboard(req, res) { res.json(await dashboard.overview()); },

  // Hotel settings
  async getSettings(req, res) { res.json(await hotel.getPublicInfo()); },
  async updateSettings(req, res) { res.json({ settings: await hotel.updateSettings(req, req.body), message: 'Hotel settings saved.' }); },
  async addHotelImages(req, res) { res.status(201).json({ images: await hotel.addImages(req, req.files, [].concat(req.body.captions || [])), message: 'Images uploaded.' }); },
  async deleteHotelImage(req, res) { await hotel.deleteImage(req, req.params.id); res.json({ message: 'Image removed.' }); },

  // Room types
  async listRoomTypes(req, res) { res.json({ items: await roomTypes.listAdmin(req.query) }); },
  async getRoomType(req, res) { res.json({ room_type: await roomTypes.getAdmin(req.params.id) }); },
  async createRoomType(req, res) { res.status(201).json({ room_type: await roomTypes.create(req, req.body), message: 'Room category created.' }); },
  async updateRoomType(req, res) { res.json({ room_type: await roomTypes.update(req, req.params.id, req.body), message: 'Room category saved.' }); },
  async archiveRoomType(req, res) { await roomTypes.archive(req, req.params.id); res.json({ message: 'Room category archived.' }); },
  async addRoomTypeImages(req, res) { res.status(201).json({ room_type: await roomTypes.addImages(req, req.params.id, req.files), message: 'Images uploaded.' }); },
  async setPrimaryImage(req, res) { res.json({ room_type: await roomTypes.setPrimaryImage(req, req.params.id, Number(req.params.imageId)) }); },
  async deleteRoomTypeImage(req, res) { res.json({ room_type: await roomTypes.deleteImage(req, req.params.id, Number(req.params.imageId)), message: 'Image removed.' }); },

  // Physical rooms
  async listRooms(req, res) { res.json({ items: await rooms.list(req.query) }); },
  async createRoom(req, res) { res.status(201).json({ room: await rooms.create(req, req.body), message: 'Room added.' }); },
  async updateRoom(req, res) { res.json({ room: await rooms.update(req, req.params.id, req.body), message: 'Room saved.' }); },
  async deleteRoom(req, res) {
    const r = await rooms.remove(req, req.params.id);
    res.json({ ...r, message: r.deleted ? 'Room deleted.' : 'Room has booking history, so it was deactivated instead.' });
  },

  // Amenities
  async listAmenities(req, res) { res.json({ items: await amenities.list() }); },
  async createAmenity(req, res) { res.status(201).json({ amenity: await amenities.create(req, req.body), message: 'Amenity added.' }); },
  async updateAmenity(req, res) { res.json({ amenity: await amenities.update(req, req.params.id, req.body), message: 'Amenity saved.' }); },
  async deleteAmenity(req, res) { await amenities.remove(req, req.params.id); res.json({ message: 'Amenity deleted.' }); },

  // Bookings
  async listBookings(req, res) { res.json(await bookings.listAdmin(req.user, req.q)); },
  async getBooking(req, res) { res.json({ booking: await bookings.getById(req.user, req.params.id) }); },
  async setBookingStatus(req, res) { res.json({ booking: await bookings.adminSetStatus(req, req.params.id, req.body), message: req.body.status === 'CONFIRMED' ? 'Reservation confirmed.' : 'Reservation cancelled.' }); },
  async reviewCancellation(req, res) { res.json({ booking: await bookings.reviewCancellation(req, req.params.id, req.body), message: req.body.approve ? 'Cancellation approved.' : 'Cancellation request declined.' }); },

  // Payments & refunds
  async listPayments(req, res) { res.json(await payments.listAdmin(req.q)); },
  async listRefunds(req, res) {
    const pg = getPagination(req.query);
    const where = req.query.status ? { refundStatus: req.query.status } : {};
    const [rows, total] = await Promise.all([
      prisma.refund.findMany({ where, include: { payment: { select: { paymentReference: true, provider: true, booking: { select: { id: true, bookingReference: true, guestFirstName: true, guestLastName: true } } } } }, orderBy: { createdAt: 'desc' }, skip: pg.skip, take: pg.take }),
      prisma.refund.count({ where }),
    ]);
    res.json(paged(serialize(rows), total, pg));
  },

  // Customers
  async listCustomers(req, res) { res.json(await users.listCustomers(req.q)); },
  async getCustomer(req, res) { res.json({ customer: await users.getCustomer(req.params.id) }); },
  async setCustomerStatus(req, res) { res.json({ user: await users.setStatus(req, req.params.id, req.body.account_status, { role: 'CUSTOMER' }), message: 'Account status updated.' }); },

  // Staff
  async listStaff(req, res) { res.json({ items: await users.listStaff(req.q), permissions: STAFF_PERMISSIONS }); },
  async createStaff(req, res) { res.status(201).json({ user: await users.createStaff(req, req.body), message: 'Receptionist account created.' }); },
  async updateStaff(req, res) { res.json({ user: await users.updateStaff(req, req.params.id, req.body), message: 'Staff account saved.' }); },

  // Coupons
  async listCoupons(req, res) { res.json(await coupons.list(req.q)); },
  async createCoupon(req, res) { res.status(201).json({ coupon: await coupons.create(req, req.body), message: 'Promotion created.' }); },
  async updateCoupon(req, res) { res.json({ coupon: await coupons.update(req, req.params.id, req.body), message: 'Promotion saved.' }); },
  async deleteCoupon(req, res) {
    const r = await coupons.remove(req, req.params.id);
    res.json({ ...r, message: r.deleted ? 'Promotion deleted.' : 'Promotion has been used, so it was deactivated instead.' });
  },

  // Reviews
  async listReviews(req, res) { res.json(await reviews.listAdmin(req.q)); },
  async moderateReview(req, res) { res.json({ review: await reviews.moderate(req, req.params.id, req.body.status), message: 'Review updated.' }); },
  async deleteReview(req, res) { await reviews.remove(req, req.params.id); res.json({ message: 'Review deleted.' }); },

  // Reports (JSON / PDF / XLSX)
  async report(req, res) {
    const report = await reports.run(req.params.name, req.q);
    if (req.q.format === 'json') return res.json(report);
    const settings = await hotel.getSettings();
    const fname = `${report.key}-report-${formatDate(new Date())}`;
    await audit.log(req, 'REPORT_EXPORTED', { entityType: 'report', entityId: report.key, description: `${req.q.format.toUpperCase()} ${report.subtitle || ''}` });
    if (req.q.format === 'pdf') {
      res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${fname}.pdf"` });
      return res.send(await exporter.reportPdf(report, settings.hotelName));
    }
    res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${fname}.xlsx"` });
    res.send(await exporter.reportXlsx(report, settings.hotelName));
  },

  // Audit logs
  async auditLogs(req, res) {
    const q = req.q;
    const pg = getPagination(q, { defaultSize: 25 });
    const where = { AND: [] };
    if (q.action) where.AND.push({ action: q.action });
    if (q.q) where.AND.push({ OR: [{ description: { contains: q.q, mode: 'insensitive' } }, { action: { contains: q.q, mode: 'insensitive' } }, { user: { email: { contains: q.q, mode: 'insensitive' } } }] });
    if (q.from) where.AND.push({ createdAt: { gte: parseDate(q.from) } });
    if (q.to) where.AND.push({ createdAt: { lt: addDays(parseDate(q.to), 1) } });
    const [rows, total, actions] = await Promise.all([
      prisma.auditLog.findMany({ where, include: { user: { select: { id: true, firstName: true, lastName: true, email: true, role: true } } }, orderBy: { createdAt: 'desc' }, skip: pg.skip, take: pg.take }),
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({ distinct: ['action'], select: { action: true }, orderBy: { action: 'asc' } }),
    ]);
    res.json({ ...paged(serialize(rows), total, pg), actions: actions.map((a) => a.action) });
  },
};
