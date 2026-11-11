#!/usr/bin/env node
/**
 * Runs a Prisma CLI command with DATABASE_SCHEMA applied to both connection strings, so migrations and
 * status checks target the same PostgreSQL schema as the app.  Usage: node scripts/prisma.js migrate deploy
 */
const path = require('path');
const { spawnSync } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const { withSchema } = require('../src/config/dbUrl');

for (const k of ['DATABASE_URL', 'DATABASE_URL_UNPOOLED']) {
  if (process.env[k]) process.env[k] = withSchema(process.env[k]);
}
const args = process.argv.slice(2);
const r = spawnSync('npx', ['prisma', ...args], { stdio: 'inherit', shell: true, cwd: path.join(__dirname, '..'), env: process.env });
process.exit(r.status ?? 1);
