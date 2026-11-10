const prisma = require('../config/prisma');
const { serialize } = require('../utils/serialize');
const storage = require('./storage.service');
const audit = require('./audit.service');
const AppError = require('../utils/AppError');

const DEFAULTS = { hotelName: 'StayEase Hotel' };

/** Hotel settings is a single-row table; create it lazily. */
async function getSettings(client = prisma) {
  const s = await client.hotelSettings.findFirst({ orderBy: { id: 'asc' } });
  return s || client.hotelSettings.create({ data: DEFAULTS });
}

async function getPublicInfo() {
  const [settings, images] = await Promise.all([getSettings(), prisma.hotelImage.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] })]);
  return { ...serialize(settings), images: serialize(images) };
}

async function updateSettings(req, data) {
  const current = await getSettings();
  const map = {
    hotel_name: 'hotelName', tagline: 'tagline', description: 'description', address: 'address', contact_number: 'contactNumber',
    email: 'email', check_in_time: 'checkInTime', check_out_time: 'checkOutTime', cancellation_policy: 'cancellationPolicy',
    hotel_policies: 'hotelPolicies', free_cancellation_hours: 'freeCancellationHours', tax_rate: 'taxRate',
    pay_at_hotel_auto_confirm: 'payAtHotelAutoConfirm', hold_minutes: 'holdMinutes', map_embed_url: 'mapEmbedUrl',
    facebook_url: 'facebookUrl', instagram_url: 'instagramUrl',
  };
  const update = {};
  for (const [k, v] of Object.entries(data)) if (map[k] && v !== undefined) update[map[k]] = v === '' ? null : v;
  if (update.taxRate !== undefined && update.taxRate !== null) update.taxRate = String(update.taxRate);
  const saved = await prisma.hotelSettings.update({ where: { id: current.id }, data: update });
  await audit.log(req, 'HOTEL_SETTINGS_UPDATED', { entityType: 'hotel_settings', entityId: saved.id, description: `Updated: ${Object.keys(update).join(', ')}` });
  return serialize(saved);
}

async function addImages(req, files, captions = []) {
  if (!files?.length) throw AppError.badRequest('Please choose at least one image.');
  const max = await prisma.hotelImage.aggregate({ _max: { sortOrder: true } });
  let order = (max._max.sortOrder ?? 0) + 1;
  const created = [];
  for (const [i, file] of files.entries()) {
    const { url, publicId } = await storage.saveImage(file, 'hotel');
    created.push(await prisma.hotelImage.create({ data: { imageUrl: url, publicId, caption: captions[i] || null, sortOrder: order++ } }));
  }
  await audit.log(req, 'HOTEL_IMAGES_ADDED', { entityType: 'hotel_images', description: `${created.length} image(s) uploaded` });
  return serialize(created);
}

async function deleteImage(req, id) {
  const img = await prisma.hotelImage.findUnique({ where: { id } });
  if (!img) throw AppError.notFound('Image not found.');
  await prisma.hotelImage.delete({ where: { id } });
  await storage.deleteImage(img.publicId);
  await audit.log(req, 'HOTEL_IMAGE_DELETED', { entityType: 'hotel_images', entityId: id });
}

module.exports = { getSettings, getPublicInfo, updateSettings, addImages, deleteImage };
