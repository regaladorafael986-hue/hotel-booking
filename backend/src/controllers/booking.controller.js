const env = require('../config/env');
const AppError = require('../utils/AppError');
const bookings = require('../services/booking.service');
const hotel = require('../services/hotel.service');
const receipts = require('../services/receipt.service');
const notifications = require('../services/notification.service');
const reviews = require('../services/review.service');

module.exports = {
  async create(req, res) {
    if (req.user.role !== 'CUSTOMER') throw AppError.forbidden('Staff accounts create reservations from the front desk (walk-in) screen.');
    if (env.requireVerifiedEmailForBooking && !req.user.emailVerifiedAt) {
      throw new AppError(403, 'Please verify your email address before making a reservation.', { code: 'EMAIL_NOT_VERIFIED' });
    }
    const booking = await bookings.create(req, req.body, { source: 'ONLINE', userId: req.user.id });
    res.status(201).json({ booking });
  },

  async mine(req, res) {
    res.json(await bookings.listMine(req.user, req.query));
  },

  async get(req, res) {
    res.json({ booking: await bookings.getById(req.user, req.params.id) });
  },

  async cancel(req, res) {
    res.json(await bookings.cancelByCustomer(req, req.params.id, req.body.reason));
  },

  async receipt(req, res) {
    const raw = await bookings.getRaw(req.params.id);
    bookings.assertCanView(req.user, raw);
    if (['PENDING_PAYMENT', 'EXPIRED'].includes(raw.bookingStatus)) throw AppError.conflict('A receipt is available once the reservation is confirmed.');
    const pdf = await receipts.bookingReceipt(raw, await hotel.getSettings());
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `${req.query.download === '1' ? 'attachment' : 'inline'}; filename="${raw.bookingReference}.pdf"` });
    res.send(pdf);
  },

  // Notifications & reviews for the logged-in user
  async notifications(req, res) {
    res.json(await notifications.listForUser(req.user.id, req.query));
  },
  async readNotification(req, res) {
    await notifications.markRead(req.user.id, req.params.id);
    res.json({ ok: true });
  },
  async readAllNotifications(req, res) {
    await notifications.markAllRead(req.user.id);
    res.json({ ok: true });
  },
  async createReview(req, res) {
    res.status(201).json({ review: await reviews.create(req, req.body), message: 'Thank you! Your review will appear once approved.' });
  },
  async myReviews(req, res) {
    res.json({ items: await reviews.listMine(req.user) });
  },
};
