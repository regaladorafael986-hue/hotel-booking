const prisma = require('../config/prisma');
const AppError = require('../utils/AppError');
const { serialize } = require('../utils/serialize');
const audit = require('./audit.service');

async function list() {
  const rows = await prisma.amenity.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { roomTypes: true } } } });
  return rows.map((a) => ({ ...serialize({ ...a, _count: undefined }), room_type_count: a._count.roomTypes }));
}

async function create(req, d) {
  const a = await prisma.amenity.create({ data: { name: d.name, icon: d.icon || null, description: d.description || null } });
  await audit.log(req, 'AMENITY_CREATED', { entityType: 'amenity', entityId: a.id, description: a.name });
  return serialize(a);
}

async function update(req, id, d) {
  if (!(await prisma.amenity.findUnique({ where: { id } }))) throw AppError.notFound('Amenity not found.');
  const a = await prisma.amenity.update({ where: { id }, data: { name: d.name, icon: d.icon || null, description: d.description || null } });
  await audit.log(req, 'AMENITY_UPDATED', { entityType: 'amenity', entityId: id, description: a.name });
  return serialize(a);
}

async function remove(req, id) {
  const a = await prisma.amenity.findUnique({ where: { id } });
  if (!a) throw AppError.notFound('Amenity not found.');
  await prisma.amenity.delete({ where: { id } });
  await audit.log(req, 'AMENITY_DELETED', { entityType: 'amenity', entityId: id, description: a.name });
}

module.exports = { list, create, update, remove };
