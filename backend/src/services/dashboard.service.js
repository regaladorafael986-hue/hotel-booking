const { Prisma } = require('@prisma/client');
const prisma = require('../config/prisma');
const { utcTimestamp, utcDate, tbl } = require('../utils/sql');
const env = require('../config/env');
const { hotelToday, addDays, formatDate, hotelDateTime } = require('../utils/dates');
const { serialize } = require('../utils/serialize');
const { toNumber } = require('../utils/money');
const availability = require('./availability.service');
const reports = require('./report.service');

const r2 = (n) => Math.round(n * 100) / 100;

async function stats() {
  const today = hotelToday();
  const tomorrow = addDays(today, 1);
  const now = new Date();
  const [
    totalReservations, totalCustomers, roomCategories, physicalRooms, occupiedRooms, pendingConfirmation, pendingPayment,
    arrivals, departures, money, avail, maintenance, cancellationRequests,
  ] = await Promise.all([
    prisma.booking.count({ where: { bookingStatus: { notIn: ['EXPIRED'] } } }),
    prisma.user.count({ where: { role: 'CUSTOMER' } }),
    prisma.roomType.count({ where: { status: 'ACTIVE' } }),
    prisma.room.count({ where: { isActive: true } }),
    prisma.bookingRoom.count({ where: { booking: { bookingStatus: 'CHECKED_IN' } } }),
    prisma.booking.count({ where: { bookingStatus: 'PENDING_CONFIRMATION' } }),
    prisma.booking.count({ where: { bookingStatus: 'PENDING_PAYMENT', expiresAt: { gt: now } } }),
    prisma.booking.count({ where: { checkIn: today, bookingStatus: { in: ['CONFIRMED', 'PENDING_CONFIRMATION', 'CHECKED_IN'] } } }),
    prisma.booking.count({ where: { checkOut: today, bookingStatus: { in: ['CHECKED_IN', 'CHECKED_OUT'] } } }),
    Promise.all([
      prisma.payment.aggregate({ where: { paymentStatus: { in: ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'] } }, _sum: { amount: true } }),
      prisma.refund.aggregate({ where: { refundStatus: 'SUCCEEDED' }, _sum: { amount: true } }),
    ]),
    availability.countAvailable(prisma, { checkIn: today, checkOut: tomorrow }),
    prisma.room.count({ where: { isActive: true, housekeepingStatus: 'MAINTENANCE' } }),
    prisma.booking.count({ where: { cancellationStatus: 'REQUESTED' } }),
  ]);
  const availableTonight = [...avail.values()].reduce((s, v) => s + v.available, 0);
  return {
    total_reservations: totalReservations,
    total_customers: totalCustomers,
    room_categories: roomCategories,
    physical_rooms: physicalRooms,
    available_rooms: availableTonight,
    occupied_rooms: occupiedRooms,
    maintenance_rooms: maintenance,
    pending_reservations: pendingConfirmation + pendingPayment,
    pending_confirmation: pendingConfirmation,
    pending_payment: pendingPayment,
    cancellation_requests: cancellationRequests,
    todays_check_ins: arrivals,
    todays_check_outs: departures,
    total_revenue: r2(toNumber(money[0]._sum.amount || 0) - toNumber(money[1]._sum.amount || 0)),
    occupancy_rate: physicalRooms ? r2((occupiedRooms / physicalRooms) * 100) : 0,
    as_of: formatDate(today),
  };
}

async function charts() {
  const today = hotelToday();
  const iso = (d) => formatDate(d);
  const yearStart = new Date(Date.UTC(today.getUTCFullYear() - 4, 0, 1));
  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 11, 1));
  const [daily, monthly, annual, occupancy] = await Promise.all([
    reports.revenueSeries({ from: iso(addDays(today, -29)), to: iso(today), group: 'day', order: 'asc' }),
    reports.revenueSeries({ from: iso(monthStart), to: iso(today), group: 'month', order: 'asc' }),
    reports.revenueSeries({ from: iso(yearStart), to: iso(today), group: 'year', order: 'asc' }),
    reports.occupancySeries({ from: iso(addDays(today, -29)), to: iso(addDays(today, 0)) }),
  ]);

  const tz = env.timezone; // IANA name, e.g. Asia/Manila (PostgreSQL has the tz database built in)
  const trendStart = hotelDateTime(addDays(today, -29), '00:00');
  const trendRows = await prisma.$queryRaw`SELECT to_char((created_at AT TIME ZONE 'UTC') AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS d, COUNT(*) AS n,
      SUM(CASE WHEN booking_status IN ('CANCELLED','EXPIRED') THEN 1 ELSE 0 END) AS lost
    FROM ${tbl('bookings')} WHERE created_at >= ${utcTimestamp(trendStart)} GROUP BY d`;
  const trendMap = new Map(trendRows.map((r) => [r.d, { n: Number(r.n), lost: Number(r.lost) }]));
  const trendLabels = [];
  for (let d = addDays(today, -29); d <= today; d = addDays(d, 1)) trendLabels.push(iso(d));

  const methods = await prisma.$queryRaw`SELECT COALESCE(payment_method, provider) AS method, SUM(amount) AS total, COUNT(*) AS n
    FROM ${tbl('payments')} WHERE payment_status IN ('PAID','PARTIALLY_REFUNDED','REFUNDED') GROUP BY method ORDER BY total DESC`;
  const yearAgo = addDays(today, -365);
  const popular = await prisma.$queryRaw`SELECT rt.name AS name, COUNT(*) AS rooms, SUM(b.nights) AS nights
    FROM ${tbl('booking_rooms')} br JOIN ${tbl('bookings')} b ON b.id = br.booking_id JOIN ${tbl('room_types')} rt ON rt.id = br.room_type_id
    WHERE b.booking_status IN ('CONFIRMED','CHECKED_IN','CHECKED_OUT') AND b.check_in >= ${utcDate(yearAgo)}
    GROUP BY rt.name ORDER BY nights DESC LIMIT 8`;

  return {
    daily_revenue: { labels: daily.rows.map((r) => r.period), data: daily.rows.map((r) => r.net) },
    monthly_revenue: { labels: monthly.rows.map((r) => r.period), data: monthly.rows.map((r) => r.net) },
    annual_revenue: { labels: annual.rows.map((r) => r.period), data: annual.rows.map((r) => r.net) },
    booking_trends: { labels: trendLabels, created: trendLabels.map((d) => trendMap.get(d)?.n || 0), lost: trendLabels.map((d) => trendMap.get(d)?.lost || 0) },
    occupancy: { labels: occupancy.rows.map((r) => r.date), data: occupancy.rows.map((r) => r.rate) },
    payment_methods: { labels: methods.map((m) => m.method), data: methods.map((m) => toNumber(m.total)), counts: methods.map((m) => Number(m.n)) },
    popular_room_types: { labels: popular.map((p) => p.name), data: popular.map((p) => Number(p.nights)), rooms: popular.map((p) => Number(p.rooms)) },
  };
}

async function recent() {
  const [bookings, payments, cancellations, customers] = await Promise.all([
    prisma.booking.findMany({ orderBy: { createdAt: 'desc' }, take: 6, select: { id: true, bookingReference: true, guestFirstName: true, guestLastName: true, checkIn: true, checkOut: true, totalAmount: true, bookingStatus: true, paymentStatus: true, createdAt: true } }),
    prisma.payment.findMany({ where: { paymentStatus: { not: 'PENDING' } }, orderBy: { updatedAt: 'desc' }, take: 6, include: { booking: { select: { id: true, bookingReference: true, guestFirstName: true, guestLastName: true } } } }),
    prisma.booking.findMany({ where: { OR: [{ bookingStatus: 'CANCELLED' }, { cancellationStatus: 'REQUESTED' }] }, orderBy: { updatedAt: 'desc' }, take: 6, select: { id: true, bookingReference: true, guestFirstName: true, guestLastName: true, cancellationStatus: true, bookingStatus: true, cancelledAt: true, cancellationRequestedAt: true, amountPaid: true } }),
    prisma.user.findMany({ where: { role: 'CUSTOMER' }, orderBy: { createdAt: 'desc' }, take: 6, select: { id: true, firstName: true, lastName: true, email: true, createdAt: true, emailVerifiedAt: true } }),
  ]);
  return { bookings: serialize(bookings), payments: serialize(payments), cancellations: serialize(cancellations), customers: serialize(customers) };
}

async function overview() {
  const [s, c, r] = await Promise.all([stats(), charts(), recent()]);
  return { stats: s, charts: c, recent: r };
}

module.exports = { overview, stats, charts, recent, Prisma };
