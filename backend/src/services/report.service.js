/**
 * Reports & analytics — all figures come from live database rows.
 * Revenue = payments collected (by paid_at) minus refunds that succeeded (by refund date), in hotel-local days.
 */
const prisma = require('../config/prisma');
const { utcTimestamp } = require('../utils/sql');
const AppError = require('../utils/AppError');
const env = require('../config/env');
const { parseDate, formatDate, hotelToday, hotelDateTime, addDays, nightsBetween } = require('../utils/dates');
const { serialize } = require('../utils/serialize');
const { toNumber } = require('../utils/money');

const MAX_RANGE_DAYS = 3700;
const MAX_ROWS = 5000;
const r2 = (n) => Math.round(n * 100) / 100;

function range(q, defaultDays = 30) {
  const to = q.to ? parseDate(q.to, 'To') : hotelToday();
  const from = q.from ? parseDate(q.from, 'From') : addDays(to, -(defaultDays - 1));
  if (from > to) throw AppError.badRequest('"From" date must be before "To" date.');
  if (nightsBetween(from, to) > MAX_RANGE_DAYS) throw AppError.badRequest('Date range is too large.');
  return { from, to, startAt: hotelDateTime(from, '00:00'), endAt: hotelDateTime(addDays(to, 1), '00:00') };
}
const rangeLabel = ({ from, to }) => `${formatDate(from)} to ${formatDate(to)}`;

function bucketKey(dateStr, group) {
  if (group === 'year') return dateStr.slice(0, 4);
  if (group === 'month') return dateStr.slice(0, 7);
  if (group === 'week') {
    const d = parseDate(dateStr);
    const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
    return formatDate(addDays(d, -dow));
  }
  return dateStr;
}
function allBuckets(from, to, group) {
  const keys = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const k = bucketKey(formatDate(d), group);
    if (keys[keys.length - 1] !== k) keys.push(k);
  }
  return keys;
}

async function dailyMoney(startAt, endAt) {
  const tz = env.timezone; // IANA name, e.g. Asia/Manila (PostgreSQL has the tz database built in)
  const [paid, refunded] = await Promise.all([
    prisma.$queryRaw`SELECT to_char((paid_at AT TIME ZONE 'UTC') AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS d, SUM(amount) AS total, COUNT(*) AS n
      FROM payments WHERE paid_at >= ${utcTimestamp(startAt)} AND paid_at < ${utcTimestamp(endAt)} AND payment_status IN ('PAID','PARTIALLY_REFUNDED','REFUNDED') GROUP BY d`,
    prisma.$queryRaw`SELECT to_char((updated_at AT TIME ZONE 'UTC') AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS d, SUM(amount) AS total
      FROM refunds WHERE refund_status = 'SUCCEEDED' AND updated_at >= ${utcTimestamp(startAt)} AND updated_at < ${utcTimestamp(endAt)} GROUP BY d`,
  ]);
  const map = new Map();
  for (const p of paid) map.set(p.d, { gross: toNumber(p.total), count: Number(p.n), refunds: 0 });
  for (const r of refunded) map.set(r.d, { ...(map.get(r.d) || { gross: 0, count: 0 }), refunds: toNumber(r.total) });
  return map;
}

async function revenueSeries(q) {
  const rg = range(q, q.group === 'year' ? 365 * 5 : q.group === 'month' ? 365 : 30);
  const group = q.group || 'day';
  const daily = await dailyMoney(rg.startAt, rg.endAt);
  const buckets = new Map(allBuckets(rg.from, rg.to, group).map((k) => [k, { period: k, payments: 0, gross: 0, refunds: 0, net: 0 }]));
  for (const [d, v] of daily) {
    const b = buckets.get(bucketKey(d, group));
    if (!b) continue;
    b.payments += v.count; b.gross += v.gross; b.refunds += v.refunds;
  }
  const rows = [...buckets.values()].map((b) => ({ ...b, gross: r2(b.gross), refunds: r2(b.refunds), net: r2(b.gross - b.refunds) }));
  return { rg, group, rows };
}

async function revenue(q) {
  const { rg, group, rows } = await revenueSeries(q);
  const sum = (k) => r2(rows.reduce((s, r) => s + r[k], 0));
  const label = { day: 'Daily', week: 'Weekly', month: 'Monthly', year: 'Annual' }[group];
  return {
    key: 'revenue', title: `${label} Revenue Report`, subtitle: rangeLabel(rg),
    columns: [{ key: 'period', label: group === 'week' ? 'Week of' : 'Period', type: 'text' }, { key: 'payments', label: 'Payments', type: 'number' }, { key: 'gross', label: 'Collected', type: 'money' }, { key: 'refunds', label: 'Refunds', type: 'money' }, { key: 'net', label: 'Net revenue', type: 'money' }],
    rows: q.order === 'asc' ? rows : rows.slice().reverse(),
    summary: [{ label: 'Collected', value: sum('gross'), type: 'money' }, { label: 'Refunded', value: sum('refunds'), type: 'money' }, { label: 'Net revenue', value: sum('net'), type: 'money' }, { label: 'Payments', value: rows.reduce((s, r) => s + r.payments, 0), type: 'number' }],
    chart: { type: 'bar', labels: rows.map((r) => r.period), series: [{ label: 'Net revenue', data: rows.map((r) => r.net) }] },
  };
}

/** Per-night occupancy: rooms held by confirmed / in-house / completed stays ÷ bookable rooms. */
async function occupancySeries(q) {
  const rg = range(q, 30);
  const totalRooms = await prisma.room.count({ where: { isActive: true, roomType: { status: 'ACTIVE' } } });
  const lines = await prisma.bookingRoom.findMany({
    where: { booking: { bookingStatus: { in: ['CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT'] }, checkIn: { lte: rg.to }, checkOut: { gt: rg.from } } },
    select: { nightlyRate: true, booking: { select: { checkIn: true, checkOut: true } } },
  });
  const rows = [];
  for (let d = rg.from; d <= rg.to; d = addDays(d, 1)) {
    const occ = lines.filter((l) => l.booking.checkIn <= d && l.booking.checkOut > d);
    const roomRevenue = occ.reduce((s, l) => s + toNumber(l.nightlyRate), 0);
    rows.push({ date: formatDate(d), occupied: occ.length, available: Math.max(0, totalRooms - occ.length), total: totalRooms, rate: totalRooms ? r2((occ.length / totalRooms) * 100) : 0, adr: occ.length ? r2(roomRevenue / occ.length) : 0, revpar: totalRooms ? r2(roomRevenue / totalRooms) : 0 });
  }
  return { rg, rows, totalRooms };
}

async function occupancy(q) {
  const { rg, rows } = await occupancySeries(q);
  const roomNights = rows.reduce((s, r) => s + r.occupied, 0);
  const capacity = rows.reduce((s, r) => s + r.total, 0);
  return {
    key: 'occupancy', title: 'Occupancy Report', subtitle: rangeLabel(rg),
    columns: [{ key: 'date', label: 'Date', type: 'date' }, { key: 'occupied', label: 'Occupied', type: 'number' }, { key: 'available', label: 'Vacant', type: 'number' }, { key: 'rate', label: 'Occupancy', type: 'percent' }, { key: 'adr', label: 'ADR', type: 'money' }, { key: 'revpar', label: 'RevPAR', type: 'money' }],
    rows: q.order === 'asc' ? rows : rows.slice().reverse(),
    summary: [{ label: 'Average occupancy', value: capacity ? r2((roomNights / capacity) * 100) : 0, type: 'percent' }, { label: 'Room-nights sold', value: roomNights, type: 'number' }, { label: 'Avg. daily rate', value: roomNights ? r2(rows.reduce((s, r) => s + r.adr * r.occupied, 0) / roomNights) : 0, type: 'money' }],
    chart: { type: 'line', labels: rows.map((r) => r.date), series: [{ label: 'Occupancy %', data: rows.map((r) => r.rate) }] },
  };
}

function applySearchSort(rows, q, columns, searchKeys) {
  let out = rows;
  if (q.q) {
    const t = q.q.toLowerCase();
    out = out.filter((r) => searchKeys.some((k) => String(r[k] ?? '').toLowerCase().includes(t)));
  }
  if (q.sort && columns.some((c) => c.key === q.sort)) {
    const dir = q.order === 'asc' ? 1 : -1;
    out = out.slice().sort((a, b) => (a[q.sort] > b[q.sort] ? dir : a[q.sort] < b[q.sort] ? -dir : 0));
  }
  return out.slice(0, MAX_ROWS);
}

const guest = (b) => `${b.guestFirstName} ${b.guestLastName}`;
const roomsOf = (b) => [...new Set(b.rooms.map((r) => r.roomType.name))].join(', ');
const bookingInclude = { rooms: { select: { roomType: { select: { name: true } }, room: { select: { roomNumber: true } } } } };

async function bookings(q) {
  const rg = range(q, 30);
  const where = { createdAt: { gte: rg.startAt, lt: rg.endAt }, ...(q.status ? { bookingStatus: { in: q.status.split(',') } } : {}) };
  const rows = await prisma.booking.findMany({ where, include: bookingInclude, orderBy: { createdAt: 'desc' }, take: MAX_ROWS });
  const data = rows.map((b) => ({ reference: b.bookingReference, booked_on: b.createdAt.toISOString(), guest: guest(b), rooms: roomsOf(b), check_in: formatDate(b.checkIn), check_out: formatDate(b.checkOut), nights: b.nights, status: b.bookingStatus, payment: b.paymentStatus, method: b.paymentMethod, source: b.source, total: toNumber(b.totalAmount) }));
  const columns = [{ key: 'reference', label: 'Reference', type: 'text' }, { key: 'booked_on', label: 'Booked', type: 'datetime' }, { key: 'guest', label: 'Guest', type: 'text' }, { key: 'rooms', label: 'Rooms', type: 'text' }, { key: 'check_in', label: 'Check-in', type: 'date' }, { key: 'check_out', label: 'Check-out', type: 'date' }, { key: 'nights', label: 'Nights', type: 'number' }, { key: 'status', label: 'Status', type: 'status' }, { key: 'payment', label: 'Payment', type: 'status' }, { key: 'total', label: 'Total', type: 'money' }];
  const out = applySearchSort(data, q, columns, ['reference', 'guest', 'rooms', 'status']);
  const byStatus = out.reduce((m, r) => ({ ...m, [r.status]: (m[r.status] || 0) + 1 }), {});
  return {
    key: 'bookings', title: 'Booking Report', subtitle: rangeLabel(rg), columns, rows: out,
    summary: [{ label: 'Bookings', value: out.length, type: 'number' }, { label: 'Booked value', value: r2(out.filter((r) => !['CANCELLED', 'EXPIRED'].includes(r.status)).reduce((s, r) => s + r.total, 0)), type: 'money' }, ...Object.entries(byStatus).map(([k, v]) => ({ label: k.replace(/_/g, ' ').toLowerCase(), value: v, type: 'number' }))],
  };
}

async function payments(q) {
  const rg = range(q, 30);
  const where = { createdAt: { gte: rg.startAt, lt: rg.endAt }, ...(q.status ? { paymentStatus: { in: q.status.split(',') } } : {}) };
  const rows = await prisma.payment.findMany({ where, include: { booking: { select: { bookingReference: true, guestFirstName: true, guestLastName: true } }, recordedBy: { select: { firstName: true, lastName: true } } }, orderBy: { createdAt: 'desc' }, take: MAX_ROWS });
  const data = rows.map((p) => ({ reference: p.paymentReference, date: (p.paidAt || p.createdAt).toISOString(), booking: p.booking.bookingReference, guest: guest(p.booking), provider: p.provider, method: p.paymentMethod || '—', status: p.paymentStatus, amount: toNumber(p.amount), refunded: toNumber(p.amountRefunded), recorded_by: p.recordedBy ? `${p.recordedBy.firstName} ${p.recordedBy.lastName}` : '' }));
  const columns = [{ key: 'reference', label: 'Payment ref', type: 'text' }, { key: 'date', label: 'Date', type: 'datetime' }, { key: 'booking', label: 'Booking', type: 'text' }, { key: 'guest', label: 'Guest', type: 'text' }, { key: 'provider', label: 'Channel', type: 'text' }, { key: 'method', label: 'Method', type: 'text' }, { key: 'status', label: 'Status', type: 'status' }, { key: 'amount', label: 'Amount', type: 'money' }, { key: 'refunded', label: 'Refunded', type: 'money' }];
  const out = applySearchSort(data, q, columns, ['reference', 'booking', 'guest', 'method']);
  const ok = out.filter((r) => ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(r.status));
  const byMethod = ok.reduce((m, r) => ({ ...m, [r.method]: r2((m[r.method] || 0) + r.amount) }), {});
  return {
    key: 'payments', title: 'Payment Report', subtitle: rangeLabel(rg), columns, rows: out,
    summary: [{ label: 'Collected', value: r2(ok.reduce((s, r) => s + r.amount, 0)), type: 'money' }, { label: 'Refunded', value: r2(ok.reduce((s, r) => s + r.refunded, 0)), type: 'money' }, ...Object.entries(byMethod).map(([k, v]) => ({ label: k, value: v, type: 'money' }))],
  };
}

async function cancellations(q) {
  const rg = range(q, 30);
  const rows = await prisma.booking.findMany({
    where: { OR: [{ cancelledAt: { gte: rg.startAt, lt: rg.endAt } }, { cancellationRequestedAt: { gte: rg.startAt, lt: rg.endAt } }] },
    include: bookingInclude, orderBy: { updatedAt: 'desc' }, take: MAX_ROWS,
  });
  const data = rows.map((b) => ({ reference: b.bookingReference, guest: guest(b), check_in: formatDate(b.checkIn), requested: b.cancellationRequestedAt?.toISOString() || '', cancelled: b.cancelledAt?.toISOString() || '', request: b.cancellationStatus, status: b.bookingStatus, reason: b.cancellationReason || '', paid: toNumber(b.amountPaid), refunded: toNumber(b.amountRefunded) }));
  const columns = [{ key: 'reference', label: 'Reference', type: 'text' }, { key: 'guest', label: 'Guest', type: 'text' }, { key: 'check_in', label: 'Check-in', type: 'date' }, { key: 'cancelled', label: 'Cancelled', type: 'datetime' }, { key: 'request', label: 'Request', type: 'status' }, { key: 'status', label: 'Status', type: 'status' }, { key: 'reason', label: 'Reason', type: 'text' }, { key: 'paid', label: 'Paid', type: 'money' }, { key: 'refunded', label: 'Refunded', type: 'money' }];
  const out = applySearchSort(data, q, columns, ['reference', 'guest', 'reason']);
  return {
    key: 'cancellations', title: 'Cancellation Report', subtitle: rangeLabel(rg), columns, rows: out,
    summary: [{ label: 'Cancelled bookings', value: out.filter((r) => r.status === 'CANCELLED').length, type: 'number' }, { label: 'Pending requests', value: out.filter((r) => r.request === 'REQUESTED').length, type: 'number' }, { label: 'Refunded', value: r2(out.reduce((s, r) => s + r.refunded, 0)), type: 'money' }],
  };
}

async function customers(q) {
  const rg = range(q, 365);
  const users = await prisma.user.findMany({ where: { role: 'CUSTOMER', ...(q.status ? { accountStatus: q.status } : {}) }, select: { id: true, firstName: true, lastName: true, email: true, phone: true, createdAt: true, accountStatus: true } });
  const stats = await prisma.booking.groupBy({ by: ['userId'], where: { userId: { not: null }, createdAt: { gte: rg.startAt, lt: rg.endAt } }, _count: true, _sum: { amountPaid: true, amountRefunded: true, nights: true } });
  const sm = new Map(stats.map((s) => [s.userId, s]));
  const data = users.map((u) => {
    const s = sm.get(u.id);
    return { name: `${u.firstName} ${u.lastName}`, email: u.email, phone: u.phone || '', joined: formatDate(u.createdAt), status: u.accountStatus, bookings: s?._count || 0, nights: s?._sum.nights || 0, spent: r2(toNumber(s?._sum.amountPaid || 0) - toNumber(s?._sum.amountRefunded || 0)) };
  });
  const columns = [{ key: 'name', label: 'Customer', type: 'text' }, { key: 'email', label: 'Email', type: 'text' }, { key: 'phone', label: 'Phone', type: 'text' }, { key: 'joined', label: 'Joined', type: 'date' }, { key: 'status', label: 'Status', type: 'status' }, { key: 'bookings', label: 'Bookings', type: 'number' }, { key: 'nights', label: 'Nights', type: 'number' }, { key: 'spent', label: 'Net spent', type: 'money' }];
  const out = applySearchSort(data, { ...q, sort: q.sort || 'spent' }, columns, ['name', 'email', 'phone']);
  return {
    key: 'customers', title: 'Customer Report', subtitle: `Booking activity ${rangeLabel(rg)}`, columns, rows: out,
    summary: [{ label: 'Customers', value: out.length, type: 'number' }, { label: 'New in period', value: out.filter((r) => r.joined >= formatDate(rg.from) && r.joined <= formatDate(rg.to)).length, type: 'number' }, { label: 'Repeat guests', value: out.filter((r) => r.bookings > 1).length, type: 'number' }],
  };
}

async function frontDesk(q, kind) {
  const rg = range(q, 7);
  const field = kind === 'checkins' ? 'checkedInAt' : 'checkedOutAt';
  const rows = await prisma.booking.findMany({ where: { [field]: { gte: rg.startAt, lt: rg.endAt } }, include: bookingInclude, orderBy: { [field]: 'desc' }, take: MAX_ROWS });
  const data = rows.map((b) => ({ reference: b.bookingReference, time: b[field].toISOString(), guest: guest(b), rooms: b.rooms.map((r) => r.room.roomNumber).join(', '), room_types: roomsOf(b), guests: b.adults + b.children, scheduled: formatDate(kind === 'checkins' ? b.checkIn : b.checkOut), balance: r2(toNumber(b.totalAmount) - toNumber(b.amountPaid)), source: b.source }));
  const columns = [{ key: 'reference', label: 'Reference', type: 'text' }, { key: 'time', label: kind === 'checkins' ? 'Checked in' : 'Checked out', type: 'datetime' }, { key: 'guest', label: 'Guest', type: 'text' }, { key: 'rooms', label: 'Room no.', type: 'text' }, { key: 'room_types', label: 'Category', type: 'text' }, { key: 'guests', label: 'Guests', type: 'number' }, { key: 'scheduled', label: kind === 'checkins' ? 'Arrival date' : 'Departure date', type: 'date' }, { key: 'balance', label: 'Balance', type: 'money' }];
  const out = applySearchSort(data, q, columns, ['reference', 'guest', 'rooms']);
  return { key: kind, title: kind === 'checkins' ? 'Check-in Report' : 'Check-out Report', subtitle: rangeLabel(rg), columns, rows: out, summary: [{ label: kind === 'checkins' ? 'Check-ins' : 'Check-outs', value: out.length, type: 'number' }, { label: 'Guests', value: out.reduce((s, r) => s + r.guests, 0), type: 'number' }] };
}

const REPORTS = {
  revenue, occupancy, bookings, payments, cancellations, customers,
  checkins: (q) => frontDesk(q, 'checkins'),
  checkouts: (q) => frontDesk(q, 'checkouts'),
};

async function run(name, q) {
  const fn = REPORTS[name];
  if (!fn) throw AppError.notFound(`Unknown report "${name}".`);
  return fn(q);
}

module.exports = { run, revenueSeries, occupancySeries, dailyMoney, range, REPORTS, serialize };
