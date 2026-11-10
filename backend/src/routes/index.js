/**
 * REST API — mounted at /api/v1
 * Roles: GUEST (no session) · CUSTOMER · RECEPTIONIST · ADMIN
 * See docs/API.md for the full reference.
 */
const express = require('express');
const { z } = require('zod');
const { validate } = require('../middleware/validate');
const { requireAuth, requireRole, requirePermission } = require('../middleware/auth');
const { authLimiter, emailLimiter } = require('../middleware/rateLimit');
const { imageUpload } = require('../middleware/upload');
const { idParams } = require('../validators/common');
const A = require('../validators/auth.validators');
const B = require('../validators/booking.validators');
const V = require('../validators/admin.validators');

const auth = require('../controllers/auth.controller');
const pub = require('../controllers/public.controller');
const booking = require('../controllers/booking.controller');
const payment = require('../controllers/payment.controller');
const staff = require('../controllers/staff.controller');
const admin = require('../controllers/admin.controller');

const r = express.Router();
const id = validate({ params: idParams });
const STAFF = requireRole('RECEPTIONIST', 'ADMIN');
const ADMIN = requireRole('ADMIN');

// ─── Auth ───
r.get('/auth/csrf', auth.csrf);
r.post('/auth/register', authLimiter, validate({ body: A.register }), auth.register);
r.post('/auth/login', authLimiter, validate({ body: A.login }), auth.login);
r.post('/auth/logout', auth.logout);
r.get('/auth/me', auth.me); // 200 with { user: null } for guests (avoids console noise on public pages)
r.post('/auth/verify-email', authLimiter, validate({ body: A.verify }), auth.verifyEmail);
r.post('/auth/resend-verification', requireAuth, emailLimiter, auth.resendVerification);
r.post('/auth/forgot-password', emailLimiter, validate({ body: A.forgot }), auth.forgotPassword);
r.post('/auth/reset-password', authLimiter, validate({ body: A.reset }), auth.resetPassword);
r.put('/auth/profile', requireAuth, validate({ body: A.profile }), auth.updateProfile);
r.put('/auth/password', requireAuth, authLimiter, validate({ body: A.changePassword }), auth.changePassword);

// ─── Public hotel & rooms ───
r.get('/hotel', pub.hotelInfo);
r.get('/rooms', validate({ query: B.listQuery }), pub.listRooms);
r.get('/rooms/filters', pub.filters);
r.get('/rooms/availability', validate({ query: B.availabilityQuery }), pub.availability);
r.get('/rooms/:id/calendar', validate({ query: B.calendarQuery }), pub.calendar);
r.get('/rooms/:id', pub.getRoom);
r.post('/bookings/quote', validate({ body: B.quote }), pub.quote);
r.get('/offers', pub.offers);
r.post('/contact', emailLimiter, validate({ body: z.object({
  name: z.string().trim().min(2, 'Please enter your name.').max(120),
  email: z.string().trim().email('Enter a valid email address.').max(191),
  phone: z.string().trim().max(30).optional().or(z.literal('')),
  subject: z.string().trim().min(3, 'Please add a subject.').max(150),
  message: z.string().trim().min(10, 'Message must be at least 10 characters.').max(4000),
}) }), pub.contact);
r.get('/reviews', pub.reviews);

// ─── Customer bookings ───
r.post('/bookings', requireAuth, validate({ body: B.createBooking }), booking.create);
r.get('/bookings/my', requireAuth, booking.mine);
r.get('/bookings/:id', requireAuth, id, booking.get);
r.get('/bookings/:id/receipt', requireAuth, id, booking.receipt);
r.post('/bookings/:id/cancel', requireAuth, id, validate({ body: B.cancel }), booking.cancel);

// ─── Notifications & reviews (self) ───
r.get('/notifications', requireAuth, booking.notifications);
r.post('/notifications/read-all', requireAuth, booking.readAllNotifications);
r.post('/notifications/:id/read', requireAuth, id, booking.readNotification);
r.post('/reviews', requireAuth, requireRole('CUSTOMER'), validate({ body: V.review }), booking.createReview);
r.get('/reviews/my', requireAuth, booking.myReviews);

// ─── Payments ───
// NOTE: POST /payments/webhook is mounted in app.js with a raw body parser (signature verification).
r.post('/payments/checkout', requireAuth, validate({ body: z.object({ booking_id: z.coerce.number().int().positive() }) }), payment.checkout);
r.get('/payments/mock/sessions/:sessionId', requireAuth, payment.mockSession);
r.post('/payments/mock/sessions/:sessionId/complete', requireAuth, validate({ body: z.object({ outcome: z.enum(['paid', 'failed']), method: z.enum(['GCASH', 'MAYA', 'CARD']).default('CARD') }) }), payment.mockComplete);
r.get('/payments/:id', requireAuth, id, payment.get);
r.post('/payments/:id/refund', ADMIN, id, validate({ body: V.refund }), payment.refund);

// ─── Front desk (receptionist + admin) ───
r.get('/staff/dashboard', STAFF, staff.dashboard);
r.get('/staff/arrivals', STAFF, staff.arrivals);
r.get('/staff/departures', STAFF, staff.departures);
r.get('/staff/in-house', STAFF, staff.inHouse);
r.get('/staff/bookings', STAFF, validate({ query: B.adminListQuery }), staff.search);
r.get('/staff/bookings/reference/:ref', STAFF, staff.findByReference);
r.get('/staff/bookings/:id', STAFF, id, staff.getBooking);
r.post('/staff/bookings/:id/check-in', requirePermission('check_in'), id, validate({ body: z.object({ override_housekeeping: z.boolean().optional() }) }), staff.checkIn);
r.post('/staff/bookings/:id/check-out', requirePermission('check_out'), id, staff.checkOut);
r.get('/staff/bookings/:id/assignable-rooms', requirePermission('assign_room'), id, staff.assignableRooms);
r.post('/staff/bookings/:id/assign-room', requirePermission('assign_room'), id, validate({ body: B.assignRoom }), staff.assignRoom);
r.post('/staff/bookings/:id/confirm', STAFF, id, staff.confirm);
r.post('/staff/payments', requirePermission('collect_payment'), validate({ body: V.staffPayment }), staff.recordPayment);
r.post('/staff/walk-ins', requirePermission('walk_in'), validate({ body: B.walkIn }), staff.walkIn);
r.get('/staff/rooms', STAFF, staff.rooms);
r.put('/staff/rooms/:id/housekeeping', requirePermission('housekeeping'), id, validate({ body: V.housekeeping }), staff.housekeeping);
r.get('/staff/customers/lookup', requirePermission('walk_in'), staff.customerLookup);

// ─── Administration ───
const ad = express.Router();
ad.use(ADMIN);
ad.get('/dashboard', admin.dashboard);

ad.get('/settings', admin.getSettings);
ad.put('/settings', validate({ body: V.settings }), admin.updateSettings);
ad.post('/settings/images', imageUpload.array('images', 10), admin.addHotelImages);
ad.delete('/settings/images/:id', id, admin.deleteHotelImage);

ad.get('/room-types', admin.listRoomTypes);
ad.post('/room-types', validate({ body: V.roomType }), admin.createRoomType);
ad.get('/room-types/:id', id, admin.getRoomType);
ad.put('/room-types/:id', id, validate({ body: V.roomTypeUpdate }), admin.updateRoomType);
ad.delete('/room-types/:id', id, admin.archiveRoomType);
ad.post('/room-types/:id/images', id, imageUpload.array('images', 10), admin.addRoomTypeImages);
ad.put('/room-types/:id/images/:imageId/primary', id, admin.setPrimaryImage);
ad.delete('/room-types/:id/images/:imageId', id, admin.deleteRoomTypeImage);

ad.get('/rooms', admin.listRooms);
ad.post('/rooms', validate({ body: V.room }), admin.createRoom);
ad.put('/rooms/:id', id, validate({ body: V.roomUpdate }), admin.updateRoom);
ad.delete('/rooms/:id', id, admin.deleteRoom);

ad.get('/amenities', admin.listAmenities);
ad.post('/amenities', validate({ body: V.amenity }), admin.createAmenity);
ad.put('/amenities/:id', id, validate({ body: V.amenity }), admin.updateAmenity);
ad.delete('/amenities/:id', id, admin.deleteAmenity);

ad.get('/bookings', validate({ query: B.adminListQuery }), admin.listBookings);
ad.get('/bookings/:id', id, admin.getBooking);
ad.put('/bookings/:id/status', id, validate({ body: B.updateStatus }), admin.setBookingStatus);
ad.post('/bookings/:id/cancellation-review', id, validate({ body: B.reviewCancellation }), admin.reviewCancellation);

ad.get('/payments', validate({ query: V.listQuery }), admin.listPayments);
ad.get('/refunds', admin.listRefunds);

ad.get('/customers', validate({ query: V.listQuery }), admin.listCustomers);
ad.get('/customers/:id', id, admin.getCustomer);
ad.put('/customers/:id/status', id, validate({ body: V.accountStatus }), admin.setCustomerStatus);

ad.get('/staff', validate({ query: V.listQuery }), admin.listStaff);
ad.post('/staff', validate({ body: V.staffCreate }), admin.createStaff);
ad.put('/staff/:id', id, validate({ body: V.staffUpdate }), admin.updateStaff);

ad.get('/coupons', validate({ query: V.listQuery }), admin.listCoupons);
ad.post('/coupons', validate({ body: V.refineCoupon(V.coupon) }), admin.createCoupon);
ad.put('/coupons/:id', id, validate({ body: V.coupon.partial() }), admin.updateCoupon);
ad.delete('/coupons/:id', id, admin.deleteCoupon);

ad.get('/reviews', validate({ query: V.listQuery }), admin.listReviews);
ad.put('/reviews/:id', id, validate({ body: V.reviewModeration }), admin.moderateReview);
ad.delete('/reviews/:id', id, admin.deleteReview);

ad.get('/reports/:name', validate({ query: V.reportQuery }), admin.report);
ad.get('/audit-logs', validate({ query: V.listQuery }), admin.auditLogs);

r.use('/admin', ad);

module.exports = r;
