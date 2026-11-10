const { z, trimmed, optionalText, email, phone, password, isoDate, id, money, bool, time } = require('./common');

const roomType = z.object({
  name: trimmed(100, 2, 'Name'),
  short_description: optionalText(255),
  description: optionalText(5000),
  base_price: money.refine((n) => n > 0, 'Base price must be greater than zero.'),
  max_adults: z.coerce.number().int().min(1, 'At least 1 adult.').max(20),
  max_children: z.coerce.number().int().min(0).max(20).default(0),
  bed_type: trimmed(60, 2, 'Bed type'),
  size_sqm: z.coerce.number().int().min(1).max(2000).optional().nullable(),
  is_featured: bool.optional(),
  amenity_ids: z.array(id).max(60).optional(),
});
const roomTypeUpdate = roomType.partial().extend({ status: z.enum(['ACTIVE', 'ARCHIVED']).optional() });

const room = z.object({
  room_type_id: id,
  room_number: trimmed(20, 1, 'Room number').regex(/^[A-Za-z0-9-]+$/, 'Room number may contain letters, digits and dashes only.'),
  floor: z.coerce.number().int().min(-5).max(200),
  housekeeping_status: z.enum(['CLEAN', 'DIRTY', 'CLEANING', 'MAINTENANCE']).optional(),
  is_active: bool.optional(),
  notes: optionalText(255),
});
const roomUpdate = room.partial();
const housekeeping = z.object({ housekeeping_status: z.enum(['CLEAN', 'DIRTY', 'CLEANING', 'MAINTENANCE']), notes: optionalText(255) });

const amenity = z.object({ name: trimmed(80, 2, 'Name'), icon: optionalText(40), description: optionalText(255) });

const settings = z.object({
  hotel_name: trimmed(120, 2, 'Hotel name').optional(),
  tagline: optionalText(200),
  description: optionalText(5000),
  address: optionalText(255),
  contact_number: phone,
  email: email.optional().or(z.literal('')),
  check_in_time: time.optional(),
  check_out_time: time.optional(),
  cancellation_policy: optionalText(5000),
  hotel_policies: optionalText(10000),
  free_cancellation_hours: z.coerce.number().int().min(0).max(720).optional(),
  tax_rate: z.coerce.number().min(0, 'Tax rate cannot be negative.').max(50, 'Tax rate must be at most 50%.').optional(),
  pay_at_hotel_auto_confirm: bool.optional(),
  hold_minutes: z.coerce.number().int().min(5, 'Hold must be at least 5 minutes.').max(120).optional(),
  map_embed_url: z.string().trim().url('Enter a valid URL.').max(500).optional().or(z.literal('')),
  facebook_url: z.string().trim().url('Enter a valid URL.').max(255).optional().or(z.literal('')),
  instagram_url: z.string().trim().url('Enter a valid URL.').max(255).optional().or(z.literal('')),
});

const coupon = z.object({
  code: trimmed(40, 3, 'Code').toUpperCase().regex(/^[A-Z0-9_-]+$/, 'Code may contain letters, digits, dashes and underscores.'),
  description: optionalText(255),
  discount_type: z.enum(['PERCENTAGE', 'FIXED']),
  discount_value: money.refine((n) => n > 0, 'Discount must be greater than zero.'),
  minimum_amount: money.default(0),
  maximum_discount: money.optional().nullable(),
  usage_limit: z.coerce.number().int().min(1).optional().nullable(),
  start_date: isoDate('Start date'),
  end_date: isoDate('End date'),
  is_featured: bool.optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE'),
});
const refineCoupon = (s) => s
  .refine((d) => !d.start_date || !d.end_date || d.end_date >= d.start_date, { message: 'End date must be on or after the start date.', path: ['end_date'] })
  .refine((d) => d.discount_type !== 'PERCENTAGE' || d.discount_value === undefined || d.discount_value <= 100, { message: 'Percentage discount cannot exceed 100%.', path: ['discount_value'] });

const PERMS = ['check_in', 'check_out', 'assign_room', 'collect_payment', 'walk_in', 'housekeeping', 'view_customers'];
const staffCreate = z.object({
  first_name: trimmed(80, 1, 'First name'),
  last_name: trimmed(80, 1, 'Last name'),
  email,
  phone,
  password,
  permissions: z.array(z.enum(PERMS)).optional(),
});
const staffUpdate = z.object({
  first_name: trimmed(80, 1, 'First name').optional(),
  last_name: trimmed(80, 1, 'Last name').optional(),
  phone,
  permissions: z.array(z.enum(PERMS)).optional(),
  account_status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  password: password.optional().or(z.literal('')),
});

const accountStatus = z.object({ account_status: z.enum(['ACTIVE', 'INACTIVE']) });

const staffPayment = z.object({
  booking_id: id,
  amount: money.refine((n) => n > 0, 'Amount must be greater than zero.'),
  payment_method: z.enum(['CASH', 'CARD', 'GCASH', 'MAYA', 'BANK_TRANSFER'], { errorMap: () => ({ message: 'Choose how the guest paid.' }) }),
  notes: optionalText(255),
});

const refund = z.object({ amount: money.refine((n) => n > 0, 'Refund amount must be greater than zero.'), reason: trimmed(255, 3, 'Reason') });

const review = z.object({ booking_id: id, rating: z.coerce.number().int().min(1, 'Rating must be 1–5.').max(5, 'Rating must be 1–5.'), title: optionalText(120), comment: optionalText(2000) });
const reviewModeration = z.object({ status: z.enum(['APPROVED', 'REJECTED', 'PENDING']) });

const reportQuery = z.object({
  from: isoDate('From').optional(),
  to: isoDate('To').optional(),
  group: z.enum(['day', 'week', 'month', 'year']).default('day'),
  format: z.enum(['json', 'pdf', 'xlsx']).default('json'),
  q: z.string().trim().max(100).optional(),
  status: z.string().trim().max(40).optional(),
  sort: z.string().trim().max(40).optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
});

const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.string().trim().max(40).optional(),
  role: z.string().trim().max(40).optional(),
  action: z.string().trim().max(80).optional(),
  from: isoDate('From').optional(),
  to: isoDate('To').optional(),
  page: z.coerce.number().int().min(1).optional(),
  page_size: z.coerce.number().int().min(1).max(100).optional(),
});

module.exports = { roomType, roomTypeUpdate, room, roomUpdate, housekeeping, amenity, settings, coupon, refineCoupon, staffCreate, staffUpdate, accountStatus, staffPayment, refund, review, reviewModeration, reportQuery, listQuery, PERMS };
