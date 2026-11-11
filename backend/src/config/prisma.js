const { PrismaClient } = require('@prisma/client');

// One client per process. On serverless (Vercel) a warm instance reuses it across requests instead of
// opening new connections; in development it also survives `node --watch` module reloads.
const prisma = global.__stayeasePrisma || new PrismaClient({ log: ['warn', 'error'] });
global.__stayeasePrisma = prisma;

module.exports = prisma;
