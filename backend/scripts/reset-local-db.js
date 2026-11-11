/**
 * `npm run db:reset`: drops and recreates the LOCAL development database, then seeds demo data.
 * Refuses to run against any non-local host (e.g. Neon), so production data can never be reset by it.
 */
const path = require('path');
const { spawnSync } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const { assertLocalDatabase } = require('./db-guard');

try {
  if (process.env.NODE_ENV === 'production' || process.env.VERCEL) throw new Error('Refusing to reset a database in a production environment.');
  assertLocalDatabase('reset the database');
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const r = spawnSync('node', [path.join(__dirname, 'prisma.js'), 'migrate', 'reset', '--force'], { stdio: 'inherit', shell: true, cwd: path.join(__dirname, '..'), env: process.env });
process.exit(r.status ?? 1);
