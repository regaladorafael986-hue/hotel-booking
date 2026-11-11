/**
 * Demo-site bootstrap: seeds the demo data ONLY when SEED_DEMO_DATA=true and the database has no
 * hotel profile yet. Safe to run on every start: once data exists it never wipes or re-seeds.
 *
 *   node scripts/seed-if-empty.js
 */
const path = require('path');
const { spawnSync } = require('child_process');
const prisma = require('../src/config/prisma');

async function main() {
  if (process.env.SEED_DEMO_DATA !== 'true') return;
  const existing = await prisma.hotelSettings.count();
  if (existing > 0) {
    console.log('[seed-if-empty] Database already has data; skipping demo seed.');
    return;
  }
  await prisma.$disconnect();
  console.log('[seed-if-empty] Empty database; loading demo data…');
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'prisma', 'seed.js')], { stdio: 'inherit', env: process.env });
  if (r.status !== 0) process.exit(r.status || 1);
}

main()
  .catch((e) => { console.error('[seed-if-empty] failed:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
