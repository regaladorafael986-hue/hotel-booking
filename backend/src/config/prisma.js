const { PrismaClient } = require('@prisma/client');

const prisma = global.__stayeasePrisma || new PrismaClient({ log: ['warn', 'error'] });
if (process.env.NODE_ENV !== 'production') global.__stayeasePrisma = prisma;

module.exports = prisma;
