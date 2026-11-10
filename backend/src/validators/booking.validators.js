const { z, trimmed, optionalText, email, phone, isoDate, id, money } = require('./common');

const intRange = (min, max, label) => z.coerce.number({ invalid_type_error: `${label} must be a number.` }).int().min(min, `${label} must be at least ${min}.`).max(max, `${label} must be at most ${max}.`);
const csvIds = z.union([z.string(), z.array(z.string())]).optional()
  .transform((v) => (v === undefined ? [] : [].concat(v).flatMap((s) => s.split(',')).map((s) => parseInt(s, 10)).filter((n) => n > 0)));

const availabilityQuery = z.object({
  check_in: isoDate('Check-in date'),
  check_out: isoDate('Check-out date'),
  adults: intRange(1, 50, 'Adults').default(2),
  children: intRange(0, 50, 'Children').default(0),
  rooms: intRange(1, 20, 'Rooms').default(1),
  min_price: z.coerce.number().min(0).optional(),
  max_price: z.coerce.number().min(0).optional(),
  room_type_id: z.coerce.number().int().positive().optional(),
  bed_type: z.string().trim().max(60).optional(),
  capacity: z.coerce.number().int().min(1).max(20).optional(),
  amenities: csvIds,
});

const listQuery = z.object({
  min_price: z.coerce.number().min(0).optional(),
  max_price: z.coerce.number().min(0).optional(),
  bed_type: z.string().trim().max(60).optional(),
  capacity: z.coerce.number().int().min(1).max(20).optional(),
  amenities: csvIds,
  featured: z.enum(['true', 'false']).optional(),
});

const calendarQuery = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/, 'month must be YYYY-MM').optional() });

const guest = z.object({
  first_name: trimmed(80, 1, 'Guest first name'),
  last_name: trimmed(80, 1, 'Guest last name'),
  email,
  phone,
});

const bookingBase = {
  check_in: isoDate('Check-in date'),
  check_out: isoDate('Check-out date'),
  adults: intRange(1, 50, 'Adults'),
  children: intRange(0, 50, 'Children').default(0),
  items: z.array(z.object({ room_type_id: id, quantity: intRange(1, 20, 'Room quantity') }), { required_error: 'Select at least one room.' })
    .min(1, 'Select at least one room.').max(5, 'Too many room categories in one booking.'),
  special_requests: optionalText(1000),
  coupon_code: z.string().trim().toUpperCase().max(40).optional().or(z.literal('')),
};

const createBooking = z.object({
  ...bookingBase,
  guest,
  payment_method: z.enum(['ONLINE', 'PAY_AT_HOTEL'], { errorMap: () => ({ message: 'Choose a payment method.' }) }),
});

const quote = z.object({ ...bookingBase });

const walkIn = z.object({
  ...bookingBase,
  guest,
  user_id: id.optional(),
  collect_payment: z.object({ amount: money, payment_method: z.enum(['CASH', 'CARD', 'GCASH', 'MAYA', 'BANK_TRANSFER']), notes: optionalText(255) }).optional(),
  check_in_now: z.boolean().optional(),
});

const cancel = z.object({ reason: trimmed(1000, 3, 'Reason') });

const adminListQuery = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.string().trim().max(40).optional(),
  payment_status: z.string().trim().max(40).optional(),
  cancellation_status: z.enum(['NONE', 'REQUESTED', 'APPROVED', 'REJECTED']).optional(),
  from: isoDate('From').optional(),
  to: isoDate('To').optional(),
  date_field: z.enum(['check_in', 'check_out', 'created_at']).default('check_in'),
  sort: z.enum(['created_at', 'check_in', 'check_out', 'total_amount']).default('created_at'),
  order: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).optional(),
  page_size: z.coerce.number().int().min(1).max(100).optional(),
});

const updateStatus = z.object({
  status: z.enum(['CONFIRMED', 'CANCELLED'], { errorMap: () => ({ message: 'Status must be CONFIRMED or CANCELLED.' }) }),
  reason: optionalText(1000),
});

const reviewCancellation = z.object({
  approve: z.boolean(),
  note: optionalText(1000),
  refund_amount: money.optional(),
});

const assignRoom = z.object({ booking_room_id: id, room_id: id });

module.exports = { availabilityQuery, listQuery, calendarQuery, createBooking, quote, walkIn, cancel, adminListQuery, updateStatus, reviewCancellation, assignRoom };
