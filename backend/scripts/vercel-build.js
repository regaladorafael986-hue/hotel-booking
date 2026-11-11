#!/usr/bin/env node
/**
 * Vercel build step (runs with the project's Root Directory, `frontend`, as the working directory).
 *
 * 1. Copies the existing frontend pages and assets, unchanged, into frontend/dist (the output Vercel's
 *    CDN serves), plus the Chart.js bundle the dashboards load from /vendor/chart.js/.
 * 2. Optionally applies pending database migrations with `prisma migrate deploy`, which only ever adds
 *    new migrations and never resets or deletes data. It runs only when MIGRATE_ON_BUILD=true is set
 *    for the Production environment, so preview builds can never change the production database.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const FRONTEND = path.resolve(__dirname, '..', '..', 'frontend');
const BACKEND = path.resolve(__dirname, '..');
const OUT = path.join(FRONTEND, 'dist');
// Not part of the website: the serverless function, build output and config files.
const SKIP = new Set(['api', 'dist', 'node_modules', '.vercel', 'vercel.json', 'package.json', 'package-lock.json']);

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
for (const entry of fs.readdirSync(FRONTEND)) {
  if (SKIP.has(entry) || entry.startsWith('.')) continue;
  fs.cpSync(path.join(FRONTEND, entry), path.join(OUT, entry), { recursive: true });
}

const chartDir = path.join(BACKEND, 'node_modules', 'chart.js', 'dist');
fs.mkdirSync(path.join(OUT, 'vendor', 'chart.js'), { recursive: true });
for (const f of ['chart.umd.min.js', 'chart.umd.min.js.map']) {
  if (fs.existsSync(path.join(chartDir, f))) fs.copyFileSync(path.join(chartDir, f), path.join(OUT, 'vendor', 'chart.js', f));
}
const files = (dir) => fs.readdirSync(dir, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? files(path.join(dir, e.name)) : 1), 0);
console.log(`[vercel-build] static site: ${files(OUT)} files → ${path.relative(process.cwd(), OUT) || OUT}`);

if (process.env.MIGRATE_ON_BUILD === 'true') {
  if (process.env.VERCEL_ENV !== 'production') {
    console.log('[vercel-build] MIGRATE_ON_BUILD is set but this is not a production build; skipping migrations.');
  } else {
    console.log('[vercel-build] applying pending migrations (prisma migrate deploy; never resets data)…');
    execSync('npx prisma migrate deploy', { cwd: BACKEND, stdio: 'inherit', env: process.env });
  }
}
