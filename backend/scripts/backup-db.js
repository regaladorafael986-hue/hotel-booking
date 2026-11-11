#!/usr/bin/env node
/**
 * Database backup: pg_dump → gzip → storage/backups/stayease_db-YYYYMMDD-HHMMSS.sql.gz
 * Keeps the newest BACKUP_RETENTION files (default 14). Schedule it daily (cron / Task Scheduler).
 *
 *   npm run db:backup
 *
 * Read-only: it never changes the database. On Neon it uses DIRECT_URL (pg_dump cannot run through the
 * pooler). Neon also keeps its own point-in-time restore history; this is an extra, offline copy.
 *
 * Env: DIRECT_URL or DATABASE_URL (required), PG_DUMP_PATH (optional; defaults to "pg_dump" on PATH),
 *      BACKUP_DIR (optional), BACKUP_RETENTION (optional).
 * Restore (into an EMPTY database only): gunzip -c file.sql.gz | psql "postgresql://…"
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { spawn } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const url = new URL(process.env.DIRECT_URL || process.env.DATABASE_URL || '');
const db = url.pathname.replace(/^\//, '').split('?')[0];
const dir = process.env.BACKUP_DIR || path.join(__dirname, '..', 'storage', 'backups');
const keep = Number(process.env.BACKUP_RETENTION || 14);
const bin = process.env.PG_DUMP_PATH || 'pg_dump';

fs.mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
const file = path.join(dir, `${db}-${stamp}.sql.gz`);

const args = ['--no-owner', '--no-privileges', '--encoding=UTF8', '-h', url.hostname, '-p', url.port || '5432', '-U', decodeURIComponent(url.username), '-d', db];
// Password via environment, never on the command line (visible in process lists).
const env = { ...process.env, PGPASSWORD: decodeURIComponent(url.password || ''), PGSSLMODE: url.searchParams.get('sslmode') || process.env.PGSSLMODE || 'prefer' };

const dump = spawn(bin, args, { env });
const out = fs.createWriteStream(file);
dump.stdout.pipe(zlib.createGzip()).pipe(out);
let stderr = '';
dump.stderr.on('data', (d) => { stderr += d; });
dump.on('error', (err) => { console.error(`Could not run ${bin}: ${err.message}. Install the PostgreSQL client tools or set PG_DUMP_PATH.`); process.exit(1); });
dump.on('close', (code) => {
  out.on('finish', () => {
    if (code !== 0) {
      fs.rmSync(file, { force: true });
      console.error(`Backup failed (exit ${code}): ${stderr.trim()}`);
      process.exit(1);
    }
    const size = fs.statSync(file).size;
    const old = fs.readdirSync(dir).filter((f) => f.startsWith(`${db}-`) && f.endsWith('.sql.gz')).sort().reverse().slice(keep);
    old.forEach((f) => fs.rmSync(path.join(dir, f)));
    console.log(`Backup written: ${file} (${(size / 1024).toFixed(1)} KB)${old.length ? `; removed ${old.length} old backup(s)` : ''}`);
  });
});
