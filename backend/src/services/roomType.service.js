const prisma = require('../config/prisma');
const AppError = require('../utils/AppError');
const { serialize } = require('../utils/serialize');
const storage = require('./storage.service');
const audit = require('./audit.service');

const slugify = (s) => s.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_-]+/g, '-').slice(0, 110);

const include = {
  images: { orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }, { id: 'asc' }] },
  amenities: { include: { amenity: true } },
  _count: { select: { rooms: { where: { isActive: true } } } },
};

function shape(rt) {
  const s = serialize({ ...rt, amenities: undefined, images: undefined, _count: undefined });
  delete s._count;
  s.images = serialize(rt.images || []);
  s.primary_image = s.images[0]?.image_url || null;
  s.amenities = (rt.amenities || []).map((a) => serialize(a.amenity));
  s.room_count = rt._count?.rooms ?? undefined;
  s.max_guests = rt.maxAdults + rt.maxChildren;
  return s;
}

/** Public listing of active room categories with optional filters (no date availability). */
async function listPublic(q = {}) {
  const where = { status: 'ACTIVE' };
  if (q.min_price !== undefined || q.max_price !== undefined) {
    where.basePrice = { ...(q.min_price !== undefined ? { gte: String(q.min_price) } : {}), ...(q.max_price !== undefined ? { lte: String(q.max_price) } : {}) };
  }
  if (q.bed_type) where.bedType = { contains: q.bed_type, mode: 'insensitive' };
  if (q.featured === 'true') where.isFeatured = true;
  if (q.amenities?.length) where.AND = q.amenities.map((amenityId) => ({ amenities: { some: { amenityId } } }));
  let rows = await prisma.roomType.findMany({ where, include, orderBy: { basePrice: 'asc' } });
  if (q.capacity) rows = rows.filter((r) => r.maxAdults + r.maxChildren >= q.capacity);
  return rows.map(shape);
}

async function getPublic(idOrSlug) {
  const where = /^\d+$/.test(String(idOrSlug)) ? { id: Number(idOrSlug) } : { slug: String(idOrSlug) };
  const rt = await prisma.roomType.findFirst({ where: { ...where, status: 'ACTIVE' }, include });
  if (!rt) throw AppError.notFound('Room not found.');
  const reviews = await prisma.review.findMany({
    where: { status: 'APPROVED', booking: { rooms: { some: { roomTypeId: rt.id } } } },
    include: { user: { select: { firstName: true, lastName: true } } },
    orderBy: { createdAt: 'desc' },
    take: 6,
  });
  const agg = await prisma.review.aggregate({ where: { status: 'APPROVED', booking: { rooms: { some: { roomTypeId: rt.id } } } }, _avg: { rating: true }, _count: true });
  return {
    ...shape(rt),
    rating: { average: agg._avg.rating ? Number(agg._avg.rating.toFixed(1)) : null, count: agg._count },
    reviews: reviews.map((r) => ({ id: r.id, rating: r.rating, title: r.title, comment: r.comment, created_at: r.createdAt, guest_name: `${r.user.firstName} ${r.user.lastName.charAt(0)}.` })),
  };
}

async function listAdmin(q = {}) {
  const where = {};
  if (q.status) where.status = q.status;
  if (q.q) where.name = { contains: q.q, mode: 'insensitive' };
  const rows = await prisma.roomType.findMany({ where, include: { ...include, _count: { select: { rooms: true } } }, orderBy: [{ status: 'asc' }, { name: 'asc' }] });
  return rows.map(shape);
}

async function getAdmin(id) {
  const rt = await prisma.roomType.findUnique({ where: { id }, include: { ...include, rooms: { orderBy: { roomNumber: 'asc' } } } });
  if (!rt) throw AppError.notFound('Room category not found.');
  return { ...shape(rt), rooms: serialize(rt.rooms) };
}

function toData(d) {
  const out = {};
  if (d.name !== undefined) { out.name = d.name; out.slug = slugify(d.name); }
  if (d.short_description !== undefined) out.shortDescription = d.short_description || null;
  if (d.description !== undefined) out.description = d.description || null;
  if (d.base_price !== undefined) out.basePrice = String(d.base_price);
  if (d.max_adults !== undefined) out.maxAdults = d.max_adults;
  if (d.max_children !== undefined) out.maxChildren = d.max_children;
  if (d.bed_type !== undefined) out.bedType = d.bed_type;
  if (d.size_sqm !== undefined) out.sizeSqm = d.size_sqm || null;
  if (d.is_featured !== undefined) out.isFeatured = d.is_featured;
  if (d.status !== undefined) out.status = d.status;
  return out;
}

async function create(req, d) {
  const rt = await prisma.roomType.create({
    data: { ...toData(d), ...(d.amenity_ids?.length ? { amenities: { create: [...new Set(d.amenity_ids)].map((amenityId) => ({ amenityId })) } } : {}) },
  });
  await audit.log(req, 'ROOM_TYPE_CREATED', { entityType: 'room_type', entityId: rt.id, description: `${rt.name} @ ${rt.basePrice}` });
  return getAdmin(rt.id);
}

async function update(req, id, d) {
  const before = await prisma.roomType.findUnique({ where: { id } });
  if (!before) throw AppError.notFound('Room category not found.');
  await prisma.$transaction(async (tx) => {
    await tx.roomType.update({ where: { id }, data: toData(d) });
    if (d.amenity_ids) {
      await tx.roomTypeAmenity.deleteMany({ where: { roomTypeId: id } });
      if (d.amenity_ids.length) await tx.roomTypeAmenity.createMany({ data: [...new Set(d.amenity_ids)].map((amenityId) => ({ roomTypeId: id, amenityId })) });
    }
  });
  const changes = [];
  if (d.base_price !== undefined && Number(before.basePrice) !== d.base_price) changes.push(`price ${before.basePrice} → ${d.base_price}`);
  if (d.status && d.status !== before.status) changes.push(`status ${before.status} → ${d.status}`);
  await audit.log(req, 'ROOM_TYPE_UPDATED', { entityType: 'room_type', entityId: id, description: `${before.name}${changes.length ? `: ${changes.join('; ')}` : ''}` });
  return getAdmin(id);
}

/** Archive instead of delete: historical bookings keep referencing the category. */
async function archive(req, id) {
  const rt = await prisma.roomType.findUnique({ where: { id } });
  if (!rt) throw AppError.notFound('Room category not found.');
  const upcoming = await prisma.bookingRoom.count({
    where: { roomTypeId: id, booking: { bookingStatus: { in: ['PENDING_PAYMENT', 'PENDING_CONFIRMATION', 'CONFIRMED', 'CHECKED_IN'] }, checkOut: { gt: new Date() } } },
  });
  if (upcoming) throw AppError.conflict(`This category has ${upcoming} active or upcoming reservation(s). Archive it after they are completed or moved.`);
  await prisma.roomType.update({ where: { id }, data: { status: 'ARCHIVED', isFeatured: false } });
  await audit.log(req, 'ROOM_TYPE_ARCHIVED', { entityType: 'room_type', entityId: id, description: rt.name });
}

async function addImages(req, id, files) {
  const rt = await prisma.roomType.findUnique({ where: { id }, include: { images: true } });
  if (!rt) throw AppError.notFound('Room category not found.');
  if (!files?.length) throw AppError.badRequest('Please choose at least one image.');
  if (rt.images.length + files.length > 20) throw AppError.badRequest('A room category can have at most 20 images.');
  let order = rt.images.reduce((m, i) => Math.max(m, i.sortOrder), 0) + 1;
  let hasPrimary = rt.images.some((i) => i.isPrimary);
  for (const file of files) {
    const { url, publicId } = await storage.saveImage(file, `rooms/${id}`);
    await prisma.roomImage.create({ data: { roomTypeId: id, imageUrl: url, publicId, isPrimary: !hasPrimary, sortOrder: order++ } });
    hasPrimary = true;
  }
  await audit.log(req, 'ROOM_IMAGES_ADDED', { entityType: 'room_type', entityId: id, description: `${files.length} image(s) added to ${rt.name}` });
  return getAdmin(id);
}

async function setPrimaryImage(req, id, imageId) {
  const img = await prisma.roomImage.findFirst({ where: { id: imageId, roomTypeId: id } });
  if (!img) throw AppError.notFound('Image not found.');
  await prisma.$transaction([
    prisma.roomImage.updateMany({ where: { roomTypeId: id }, data: { isPrimary: false } }),
    prisma.roomImage.update({ where: { id: imageId }, data: { isPrimary: true } }),
  ]);
  return getAdmin(id);
}

async function deleteImage(req, id, imageId) {
  const img = await prisma.roomImage.findFirst({ where: { id: imageId, roomTypeId: id } });
  if (!img) throw AppError.notFound('Image not found.');
  await prisma.roomImage.delete({ where: { id: imageId } });
  if (img.isPrimary) {
    const next = await prisma.roomImage.findFirst({ where: { roomTypeId: id }, orderBy: { sortOrder: 'asc' } });
    if (next) await prisma.roomImage.update({ where: { id: next.id }, data: { isPrimary: true } });
  }
  await storage.deleteImage(img.publicId);
  await audit.log(req, 'ROOM_IMAGE_DELETED', { entityType: 'room_type', entityId: id });
  return getAdmin(id);
}

async function bedTypes() {
  const rows = await prisma.roomType.findMany({ where: { status: 'ACTIVE' }, select: { bedType: true }, distinct: ['bedType'] });
  return rows.map((r) => r.bedType).sort();
}

module.exports = { listPublic, getPublic, listAdmin, getAdmin, create, update, archive, addImages, setPrimaryImage, deleteImage, bedTypes, shape, slugify };
