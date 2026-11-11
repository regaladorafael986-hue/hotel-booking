const { PrismaClient } = require('@prisma/client');
const { withSchema } = require('./dbUrl');

// One client per process. On serverless (Vercel) a warm instance reuses it across requests instead of
// opening new connections; in development it also survives `node --watch` module reloads.
// DATABASE_SCHEMA (if set) selects the PostgreSQL schema that holds StayEase's tables.
const prisma = global.__stayeasePrisma || new PrismaClient({ log: ['warn', 'error'], datasourceUrl: withSchema(process.env.DATABASE_URL) });
global.__stayeasePrisma = prisma;

module.exports = prisma;
