/**
 * Development / demonstration seed data. NEVER run against production.
 * Creates the hotel profile, room catalogue, physical rooms, accounts, coupons and ~4 months of
 * realistic booking history. Historical bookings are placed using the real availability engine,
 * so seeded data never double-books a room.
 *
 *   npm run db:seed
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
// Staff passwords are published in the README, so a production (online demo) seed must supply its own.
const PW = {
  admin: process.env.SEED_ADMIN_PASSWORD || 'Admin@12345',
  staff: process.env.SEED_STAFF_PASSWORD || 'Staff@12345',
  guest: process.env.SEED_GUEST_PASSWORD || 'Guest@12345',
};
if (process.env.NODE_ENV === 'production') {
  if (process.env.SEED_DEMO_DATA !== 'true') {
    console.error('Refusing to seed a production database (set SEED_DEMO_DATA=true only for a demo site).');
    process.exit(1);
  }
  if (!process.env.SEED_ADMIN_PASSWORD || PW.admin.length < 10 || !process.env.SEED_STAFF_PASSWORD || PW.staff.length < 10) {
    console.error('Demo seed in production needs SEED_ADMIN_PASSWORD and SEED_STAFF_PASSWORD (10+ characters each).');
    process.exit(1);
  }
}
const SHOW_PW = process.env.NODE_ENV !== 'production';

const bcrypt = require('bcryptjs');
const prisma = require('../src/config/prisma');
const availability = require('../src/services/availability.service');
const { hotelToday, addDays, hotelDateTime } = require('../src/utils/dates');
const { randomCode } = require('../src/utils/crypto');
const { isLocalUrl, hostOf } = require('../scripts/db-guard');

const img = (id, w = 1600) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${w}&q=80`;
const P = {
  heroPool: 'photo-1566073771259-6a8506099945', villa: 'photo-1582719478250-c89cae4dc85b', queen: 'photo-1631049307264-da0ec9d70304',
  classic2: 'photo-1611892440504-42a792e24d32', woodKing: 'photo-1590490360182-c33d57733427', twilight: 'photo-1542314831-068cd1dbfeeb',
  loft: 'photo-1578683010236-d716f9a3f461', poolBlue: 'photo-1571896349842-33c89424de2d', poolWhite: 'photo-1564501049412-61c2a3083791',
  tufted: 'photo-1505693416388-ac5ce068fe85', modernKing: 'photo-1591088398332-8a7791972843', living: 'photo-1560448204-e02f11c3d0e2',
  ocean: 'photo-1540541338287-41700207dee6', bath: 'photo-1584622650111-993a426fbf0a', white: 'photo-1576675784201-0e142b423952',
  dining: 'photo-1414235077428-338989a2e8c0', spa: 'photo-1544161515-4ab6ce6db874', gym: 'photo-1534438327276-14e5300c3a48',
  palms: 'photo-1600011689032-8b628b8a8747', twin: 'photo-1595576508898-0ad5c879a061', darkKing: 'photo-1566665797739-1674de7a421a',
  cityView: 'photo-1568495248636-6432b97bd949', goldKing: 'photo-1587985064135-0366536eab42', minimal: 'photo-1629140727571-9b5c6f6267b4',
  suite: 'photo-1618773928121-c32242e63f39',
};

// Deterministic pseudo-random so every seed produces the same demo story.
let s = 20261110;
const rand = () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const between = (a, b) => a + Math.floor(rand() * (b - a + 1));
const money = (n) => (Math.round(n * 100) / 100).toFixed(2);

async function wipe() {
  // Child tables first.
  for (const t of ['paymentEvent', 'refund', 'payment', 'review', 'notification', 'bookingRoom', 'booking', 'coupon', 'roomTypeAmenity', 'roomImage', 'room', 'roomType', 'amenity', 'hotelImage', 'hotelSettings', 'auditLog', 'authToken', 'session', 'user']) {
    await prisma[t].deleteMany();
  }
}

/** The demo seed starts by wiping every table, so on any non-local database it only runs when that database is empty. */
async function assertSafeToWipe() {
  if (isLocalUrl(process.env.DATABASE_URL) && (!process.env.DIRECT_URL || isLocalUrl(process.env.DIRECT_URL))) return;
  const [users, bookings, hotels] = await Promise.all([prisma.user.count(), prisma.booking.count(), prisma.hotelSettings.count()]);
  if (users || bookings || hotels) {
    throw new Error(`Refusing to seed: the database at "${hostOf(process.env.DATABASE_URL)}" already has data ` +
      `(${users} users, ${bookings} bookings) and seeding would erase it.`);
  }
}

async function main() {
  await assertSafeToWipe();
  console.log('Seeding StayEase demo data…');
  await wipe();
  const today = hotelToday();

  // ─── Hotel ───
  const settings = await prisma.hotelSettings.create({
    data: {
      hotelName: 'StayEase Hotel & Suites',
      tagline: 'Unhurried stays in the heart of the city',
      description: 'StayEase is an independent boutique hotel offering 25 thoughtfully designed rooms and suites, a rooftop infinity pool, an all-day dining room and a quiet spa — a calm base whether you are in town for business or a long weekend away.',
      address: '88 Harbor View Drive, Pasay City, Metro Manila, Philippines',
      contactNumber: '+63 2 8123 4567',
      checkInTime: '14:00',
      checkOutTime: '12:00',
      freeCancellationHours: 48,
      cancellationPolicy: 'Free cancellation up to 48 hours before the check-in time. Cancellations made later, or no-shows, may be charged the first night. Refunds for online payments are returned to the original payment method within 5–10 business days.',
      hotelPolicies: 'Check-in from 2:00 PM; check-out until 12:00 NN.\nA valid government-issued photo ID is required at check-in.\nChildren 6 years and below stay free when using existing bedding.\nSmoking is not permitted inside rooms; designated areas are available.\nPets are not allowed, except service animals.\nQuiet hours are from 10:00 PM to 7:00 AM.',
      taxRate: '12.00',
      payAtHotelAutoConfirm: true,
      holdMinutes: 15,
      mapEmbedUrl: 'https://www.google.com/maps?q=Pasay+City+Metro+Manila&output=embed',
    },
  });
  await prisma.hotelImage.createMany({
    data: [
      { imageUrl: img(P.twilight, 2000), caption: 'Rooftop infinity pool at dusk', sortOrder: 1 },
      { imageUrl: img(P.poolWhite), caption: 'Pool deck', sortOrder: 2 },
      { imageUrl: img(P.dining), caption: 'The Harbor Room — all-day dining', sortOrder: 3 },
      { imageUrl: img(P.spa), caption: 'Lumen Spa', sortOrder: 4 },
      { imageUrl: img(P.gym), caption: 'Fitness studio', sortOrder: 5 },
      { imageUrl: img(P.palms), caption: 'Sunset at the lounge', sortOrder: 6 },
    ],
  });

  // ─── Amenities ───
  const amenityDefs = [
    ['Free Wi-Fi', 'wifi'], ['Air conditioning', 'snow'], ['Smart TV', 'tv'], ['Rain shower', 'shower'], ['Bathtub', 'bath'],
    ['Minibar', 'glass'], ['Coffee & tea set', 'coffee'], ['In-room safe', 'lock'], ['Work desk', 'desk'], ['City view', 'city'],
    ['Living area', 'sofa'], ['Kitchenette', 'kitchen'], ['Bathrobe & slippers', 'robe'], ['Breakfast included', 'breakfast'], ['Club lounge access', 'star'],
  ];
  const amen = {};
  for (const [name, icon] of amenityDefs) amen[name] = (await prisma.amenity.create({ data: { name, icon } })).id;

  // ─── Room categories ───
  const typeDefs = [
    {
      name: 'Classic Queen', basePrice: 3800, maxAdults: 2, maxChildren: 1, bedType: 'Queen bed', sizeSqm: 24, isFeatured: false,
      short: 'A bright, efficient room with a plush queen bed — ideal for solo travellers and couples.',
      desc: 'Our Classic Queen rooms pair a premium queen bed with blackout drapes, a compact work desk and a walk-in rain shower. Everything you need for a restful city stay, at a friendly rate.',
      images: [P.queen, P.white, P.minimal], amenities: ['Free Wi-Fi', 'Air conditioning', 'Smart TV', 'Rain shower', 'Coffee & tea set', 'In-room safe', 'Work desk'],
      rooms: { floor: 2, count: 6 },
    },
    {
      name: 'Superior Twin', basePrice: 4500, maxAdults: 2, maxChildren: 1, bedType: '2 Twin beds', sizeSqm: 28, isFeatured: true,
      short: 'Two comfortable twin beds and extra floor space for friends or colleagues travelling together.',
      desc: 'Designed for travel companions, the Superior Twin offers two full-size single beds, a generous wardrobe, a minibar and a modern bathroom with a rain shower.',
      images: [P.twin, P.classic2, P.bath], amenities: ['Free Wi-Fi', 'Air conditioning', 'Smart TV', 'Rain shower', 'Minibar', 'Coffee & tea set', 'In-room safe', 'Work desk'],
      rooms: { floor: 3, count: 6 },
    },
    {
      name: 'Deluxe King', basePrice: 5900, maxAdults: 2, maxChildren: 2, bedType: 'King bed', sizeSqm: 34, isFeatured: true,
      short: 'Our most-loved room: a king bed, city views and a deep soaking tub.',
      desc: 'The Deluxe King is a calm retreat above the city with floor-to-ceiling windows, a king bed dressed in 400-thread-count linen, a deep soaking bathtub and a separate rain shower. Breakfast for two is included.',
      images: [P.darkKing, P.modernKing, P.goldKing, P.bath], amenities: ['Free Wi-Fi', 'Air conditioning', 'Smart TV', 'Rain shower', 'Bathtub', 'Minibar', 'Coffee & tea set', 'In-room safe', 'Work desk', 'City view', 'Bathrobe & slippers', 'Breakfast included'],
      rooms: { floor: 4, count: 6 },
    },
    {
      name: 'Family Suite', basePrice: 8900, maxAdults: 4, maxChildren: 2, bedType: 'King bed + 2 Twin beds', sizeSqm: 52, isFeatured: true,
      short: 'Two connected spaces with room for the whole family and a kitchenette for easy snacks.',
      desc: 'Spacious and practical, the Family Suite combines a king bedroom with a second room of twin beds, a living area with sofa, a kitchenette and two bathrooms. Breakfast for four is included.',
      images: [P.living, P.tufted, P.suite], amenities: ['Free Wi-Fi', 'Air conditioning', 'Smart TV', 'Rain shower', 'Bathtub', 'Minibar', 'Coffee & tea set', 'In-room safe', 'Living area', 'Kitchenette', 'Bathrobe & slippers', 'Breakfast included'],
      rooms: { floor: 5, count: 4 },
    },
    {
      name: 'Executive Suite', basePrice: 12500, maxAdults: 2, maxChildren: 1, bedType: 'King bed', sizeSqm: 60, isFeatured: true,
      short: 'Panoramic corner suite with a separate living room and club lounge access.',
      desc: 'Our signature corner suites feature wraparound windows, a separate living and dining area, a marble bathroom with freestanding tub, and complimentary access to the club lounge for breakfast, afternoon tea and evening cocktails.',
      images: [P.loft, P.cityView, P.woodKing, P.bath], amenities: ['Free Wi-Fi', 'Air conditioning', 'Smart TV', 'Rain shower', 'Bathtub', 'Minibar', 'Coffee & tea set', 'In-room safe', 'Work desk', 'City view', 'Living area', 'Bathrobe & slippers', 'Breakfast included', 'Club lounge access'],
      rooms: { floor: 6, count: 3 },
    },
  ];
  const types = [];
  for (const t of typeDefs) {
    const rt = await prisma.roomType.create({
      data: {
        name: t.name, slug: t.name.toLowerCase().replace(/\s+/g, '-'), shortDescription: t.short, description: t.desc, basePrice: money(t.basePrice),
        maxAdults: t.maxAdults, maxChildren: t.maxChildren, bedType: t.bedType, sizeSqm: t.sizeSqm, isFeatured: t.isFeatured,
        images: { create: t.images.map((id, i) => ({ imageUrl: img(id), isPrimary: i === 0, sortOrder: i })) },
        amenities: { create: t.amenities.map((a) => ({ amenityId: amen[a] })) },
      },
    });
    for (let i = 1; i <= t.rooms.count; i++) {
      await prisma.room.create({ data: { roomTypeId: rt.id, roomNumber: `${t.rooms.floor}${String(i).padStart(2, '0')}`, floor: t.rooms.floor } });
    }
    types.push({ ...rt, def: t });
  }

  // ─── Accounts ───
  const hash = (pw) => bcrypt.hash(pw, 10);
  const admin = await prisma.user.create({ data: { firstName: 'Andrea', lastName: 'Villanueva', email: 'admin@stayease.test', phone: '+63 917 555 0101', passwordHash: await hash(PW.admin), role: 'ADMIN', emailVerifiedAt: new Date() } });
  const reception = await prisma.user.create({ data: { firstName: 'Marco', lastName: 'Dela Cruz', email: 'frontdesk@stayease.test', phone: '+63 917 555 0102', passwordHash: await hash(PW.staff), role: 'RECEPTIONIST', emailVerifiedAt: new Date() } });
  await prisma.user.create({ data: { firstName: 'Liza', lastName: 'Ramos', email: 'night.audit@stayease.test', phone: '+63 917 555 0103', passwordHash: await hash(PW.staff), role: 'RECEPTIONIST', permissions: ['check_in', 'check_out', 'collect_payment', 'housekeeping'], emailVerifiedAt: new Date() } });

  const customerPw = await hash(PW.guest);
  const names = [
    ['Jamie', 'Santos'], ['Paolo', 'Reyes'], ['Bea', 'Mendoza'], ['Carlo', 'Garcia'], ['Nina', 'Torres'], ['Miguel', 'Aquino'], ['Sofia', 'Lim'],
    ['Daniel', 'Tan'], ['Kristine', 'Navarro'], ['Rafael', 'Castillo'], ['Hannah', 'Lee'], ['Ethan', 'Cruz'], ['Isabel', 'Fernandez'], ['Luis', 'Bautista'],
    ['Grace', 'Ong'], ['Noah', 'Rivera'], ['Patricia', 'Gomez'], ['Joshua', 'Del Rosario'], ['Camille', 'Uy'], ['Adrian', 'Pascual'],
  ];
  const customers = [];
  for (const [i, [f, l]] of names.entries()) {
    const email = i === 0 ? 'guest@stayease.test' : `${f}.${l}`.toLowerCase().replace(/\s+/g, '') + '@example.com';
    const createdAt = addDays(today, -between(20, 200));
    customers.push(await prisma.user.create({ data: { firstName: f, lastName: l, email, phone: `+63 9${between(10, 99)} ${between(100, 999)} ${between(1000, 9999)}`, passwordHash: customerPw, role: 'CUSTOMER', emailVerifiedAt: i === 19 ? null : createdAt, createdAt } }));
  }

  // ─── Coupons ───
  const welcome = await prisma.coupon.create({ data: { code: 'WELCOME10', description: '10% off your first stay with us', discountType: 'PERCENTAGE', discountValue: '10', minimumAmount: '3000', maximumDiscount: '2500', usageLimit: 500, startDate: addDays(today, -120), endDate: addDays(today, 240), isFeatured: true } });
  await prisma.coupon.create({ data: { code: 'STAYLONGER', description: '₱1,500 off stays worth ₱15,000 or more', discountType: 'FIXED', discountValue: '1500', minimumAmount: '15000', usageLimit: null, startDate: addDays(today, -30), endDate: addDays(today, 180), isFeatured: true } });
  await prisma.coupon.create({ data: { code: 'RAINY25', description: 'Rainy-season flash sale', discountType: 'PERCENTAGE', discountValue: '25', minimumAmount: '0', maximumDiscount: '4000', usageLimit: 50, usedCount: 50, startDate: addDays(today, -150), endDate: addDays(today, -60), status: 'ACTIVE' } });
  await prisma.coupon.create({ data: { code: 'HOLIDAY15', description: '15% off holiday stays', discountType: 'PERCENTAGE', discountValue: '15', minimumAmount: '8000', maximumDiscount: '5000', usageLimit: 200, startDate: addDays(today, 20), endDate: addDays(today, 60), isFeatured: false } });

  // ─── Booking history ───
  const taxRate = 12;
  const reviewsText = [
    [5, 'Wonderful stay', 'Spotless room, very comfortable bed and the front desk team went out of their way to help us. Will be back!'],
    [5, 'Perfect weekend', 'The rooftop pool at sunset is unbeatable. Breakfast spread was excellent.'],
    [4, 'Great location', 'Easy to get around the city. Room was quiet despite being near the main road. Wi-Fi could be faster.'],
    [5, 'Family-friendly', 'The Family Suite had plenty of space for our kids and the kitchenette was super handy.'],
    [4, 'Smooth business trip', 'Fast check-in, good desk and fast Wi-Fi. Gym is small but well equipped.'],
    [3, 'Good but noisy', 'Room was nice, but there was some construction noise during the day.'],
    [5, 'Exceptional service', 'Staff remembered our names by day two. The Executive Suite views are stunning.'],
  ];
  let created = 0;
  const methods = ['GCASH', 'MAYA', 'CARD', 'CARD', 'GCASH'];
  const deskMethods = ['CASH', 'CARD', 'CASH', 'GCASH'];

  for (let dayOffset = -120; dayOffset <= 45; dayOffset++) {
    const perDay = dayOffset < 0 ? between(1, 3) : dayOffset <= 14 ? between(0, 2) : between(0, 1);
    for (let k = 0; k < perDay; k++) {
      const checkIn = addDays(today, dayOffset);
      const nights = pick([1, 1, 2, 2, 2, 3, 3, 4, 5]);
      const checkOut = addDays(checkIn, nights);
      const t = pick([types[0], types[0], types[1], types[1], types[2], types[2], types[2], types[3], types[4]]);
      const qty = t.def.rooms.count > 4 && rand() < 0.12 ? 2 : 1;
      const free = await availability.findFreeRooms(prisma, { roomTypeId: t.id, checkIn, checkOut, limit: qty });
      if (free.length < qty) continue;

      const cust = pick(customers.slice(0, 19));
      const walkIn = rand() < 0.12;
      const online = !walkIn && rand() < 0.55;
      const leadDays = between(1, 40);
      let createdAt = hotelDateTime(addDays(checkIn, -leadDays), `${String(between(8, 21)).padStart(2, '0')}:${String(between(0, 59)).padStart(2, '0')}`);
      // Lead time would put the booking in the future: spread it over the last few weeks instead.
      if (createdAt.getTime() > Date.now() - 3600_000) createdAt = new Date(Date.now() - (between(2, 28) * 24 + between(1, 20)) * 3600_000);
      const adults = Math.min(t.maxAdults * qty, between(qty, t.maxAdults * qty));
      const children = rand() < 0.25 ? Math.min(t.maxChildren * qty, 1) : 0;
      const subtotal = Number(t.basePrice) * nights * qty;
      const useCoupon = !walkIn && rand() < 0.15 && subtotal >= 3000;
      const discount = useCoupon ? Math.min(subtotal * 0.1, 2500) : 0;
      const taxes = Math.round((subtotal - discount) * taxRate) / 100;
      const total = subtotal - discount + taxes;

      let status;
      if (dayOffset < 0 && addDays(checkIn, nights) <= today) status = rand() < 0.1 ? 'CANCELLED' : 'CHECKED_OUT';
      else if (dayOffset <= 0) status = rand() < 0.05 ? 'CANCELLED' : 'CHECKED_IN';
      else status = rand() < 0.08 ? 'CANCELLED' : !online && rand() < 0.15 ? 'PENDING_CONFIRMATION' : 'CONFIRMED';
      if (dayOffset === 0 && status === 'CHECKED_IN' && rand() < 0.5) status = 'CONFIRMED'; // some arrivals still to come today

      const paidOnline = online && status !== 'PENDING_CONFIRMATION';
      const paidAtDesk = !online && ['CHECKED_IN', 'CHECKED_OUT'].includes(status) && (status === 'CHECKED_OUT' || rand() < 0.6);
      const cancelledPaid = status === 'CANCELLED' && online;
      const amountPaid = paidOnline || paidAtDesk ? total : 0;
      const refunded = cancelledPaid ? total : 0;
      const ref = `SE-${randomCode(8)}`;
      const guest = walkIn ? { f: pick(['Ana', 'Ben', 'Cara', 'Diego', 'Elena']), l: pick(['Morales', 'Salazar', 'Vergara', 'Aguilar']), e: `walkin.${randomCode(4).toLowerCase()}@example.com` } : { f: cust.firstName, l: cust.lastName, e: cust.email };

      const booking = await prisma.booking.create({
        data: {
          bookingReference: ref, userId: walkIn ? null : cust.id, createdById: walkIn ? reception.id : null, source: walkIn ? 'WALK_IN' : 'ONLINE',
          guestFirstName: guest.f, guestLastName: guest.l, guestEmail: guest.e, guestPhone: cust.phone,
          checkIn, checkOut, nights, adults, children, totalRooms: qty,
          subtotal: money(subtotal), discount: money(discount), taxes: money(taxes), totalAmount: money(total),
          amountPaid: money(amountPaid), amountRefunded: money(refunded), couponId: useCoupon ? welcome.id : null, couponCode: useCoupon ? 'WELCOME10' : null,
          bookingStatus: status, paymentStatus: refunded ? 'REFUNDED' : amountPaid >= total ? 'PAID' : 'PENDING', paymentMethod: online ? 'ONLINE' : 'PAY_AT_HOTEL',
          confirmedAt: ['CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT'].includes(status) ? createdAt : null,
          checkedInAt: ['CHECKED_IN', 'CHECKED_OUT'].includes(status) ? hotelDateTime(checkIn, `${between(14, 20)}:${String(between(0, 59)).padStart(2, '0')}`) : null,
          checkedOutAt: status === 'CHECKED_OUT' ? hotelDateTime(checkOut, `${between(8, 11)}:${String(between(0, 59)).padStart(2, '0')}`) : null,
          cancelledAt: status === 'CANCELLED' ? new Date(Math.min(addDays(createdAt, 1).getTime(), Date.now() - 2 * 3600_000)) : null,
          cancellationStatus: status === 'CANCELLED' ? 'APPROVED' : 'NONE',
          cancellationReason: status === 'CANCELLED' ? pick(['Change of travel plans', 'Flight was cancelled', 'Booked the wrong dates', 'Work trip postponed']) : null,
          createdAt,
          rooms: { create: free.map((r, i) => ({ roomId: r.id, roomTypeId: t.id, nightlyRate: t.basePrice, adults: Math.max(1, Math.ceil(adults / qty) - (i && adults % qty ? 1 : 0)), children: i === 0 ? children : 0 })) },
        },
      });
      created++;

      if (paidOnline) {
        const paidAt = new Date(createdAt.getTime() + between(2, 12) * 60000);
        const pay = await prisma.payment.create({ data: { bookingId: booking.id, paymentReference: `PAY-${randomCode(10)}`, provider: 'MOCK', providerSessionId: `mock_cs_seed_${randomCode(12)}`, providerPaymentId: `mock_pay_${randomCode(8)}`, amount: money(total), amountRefunded: money(refunded), paymentMethod: pick(methods), paymentStatus: refunded ? 'REFUNDED' : 'PAID', paidAt, createdAt: paidAt } });
        if (refunded) await prisma.refund.create({ data: { paymentId: pay.id, amount: money(refunded), reason: 'Cancellation within free-cancellation window', refundStatus: 'SUCCEEDED', providerReference: `mock_rf_${randomCode(8)}`, processedById: admin.id, createdAt: addDays(createdAt, 1), updatedAt: addDays(createdAt, 1) } });
      } else if (paidAtDesk) {
        const paidAt = status === 'CHECKED_OUT' ? hotelDateTime(checkOut, '09:30') : hotelDateTime(checkIn, '15:10');
        await prisma.payment.create({ data: { bookingId: booking.id, paymentReference: `PAY-${randomCode(10)}`, provider: 'FRONT_DESK', amount: money(total), paymentMethod: pick(deskMethods), paymentStatus: 'PAID', paidAt, recordedById: reception.id, createdAt: paidAt } });
      }

      if (status === 'CHECKED_OUT' && !walkIn && rand() < 0.35) {
        const [rating, title, comment] = pick(reviewsText);
        await prisma.review.create({ data: { bookingId: booking.id, userId: cust.id, rating, title, comment, status: rand() < 0.85 ? 'APPROVED' : 'PENDING', createdAt: addDays(checkOut, between(0, 3)) } });
      }
    }
  }

  await prisma.coupon.update({ where: { id: welcome.id }, data: { usedCount: await prisma.booking.count({ where: { couponId: welcome.id, bookingStatus: { notIn: ['CANCELLED', 'EXPIRED'] } } }) } });

  // A pending cancellation request and a pay-at-hotel booking awaiting confirmation for the demo customer.
  const demo = customers[0];
  const upcoming = await prisma.booking.findFirst({ where: { userId: { not: demo.id }, bookingStatus: 'CONFIRMED', paymentMethod: 'ONLINE', checkIn: { gt: addDays(today, 5) } } });
  if (upcoming) await prisma.booking.update({ where: { id: upcoming.id }, data: { cancellationStatus: 'REQUESTED', cancellationReason: 'Family emergency — need to postpone', cancellationRequestedAt: new Date() } });

  // Housekeeping realism: rooms of today's departures are dirty, one is being cleaned, one is under maintenance (with no future bookings).
  const departedToday = await prisma.bookingRoom.findMany({ where: { booking: { bookingStatus: 'CHECKED_OUT', checkOut: today } }, select: { roomId: true } });
  if (departedToday.length) await prisma.room.updateMany({ where: { id: { in: departedToday.map((d) => d.roomId) } }, data: { housekeepingStatus: 'DIRTY' } });
  const anyRoom = await prisma.room.findFirst({ where: { housekeepingStatus: 'CLEAN', roomType: { name: 'Classic Queen' } }, orderBy: { roomNumber: 'desc' } });
  const futureHolds = anyRoom ? await prisma.bookingRoom.count({ where: { roomId: anyRoom.id, booking: { checkOut: { gt: today }, bookingStatus: { in: ['CONFIRMED', 'CHECKED_IN', 'PENDING_CONFIRMATION'] } } } }) : 1;
  if (anyRoom && !futureHolds) await prisma.room.update({ where: { id: anyRoom.id }, data: { housekeepingStatus: 'MAINTENANCE', notes: 'Air-con unit replacement' } });

  // Welcome notification for the demo customer
  await prisma.notification.create({ data: { userId: demo.id, title: 'Welcome to StayEase', message: 'Thanks for joining! Use code WELCOME10 for 10% off your first stay.', type: 'SYSTEM' } });

  const counts = await Promise.all([prisma.booking.count(), prisma.payment.count(), prisma.review.count(), prisma.room.count()]);
  console.log(`  ✓ Hotel "${settings.hotelName}", ${types.length} room categories, ${counts[3]} physical rooms`);
  console.log(`  ✓ ${customers.length} customers, ${counts[0]} bookings (${created} generated), ${counts[1]} payments, ${counts[2]} reviews`);
  console.log('\n  Demo logins:');
  const show = (pw) => (SHOW_PW ? pw : '(set via SEED_* environment variable)');
  console.log(`    Admin         admin@stayease.test      / ${show(PW.admin)}`);
  console.log(`    Receptionist  frontdesk@stayease.test  / ${show(PW.staff)}`);
  console.log(`    Customer      guest@stayease.test      / ${process.env.SEED_GUEST_PASSWORD ? show(PW.guest) : PW.guest}\n`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
