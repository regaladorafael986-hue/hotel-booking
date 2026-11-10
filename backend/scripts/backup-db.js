#!/usr/bin/env node
/**
 * Database backup: mysqldump → gzip → storage/backups/stayease_db-YYYYMMDD-HHMMSS.sql.gz
 * Keeps the newest BACKUP_RETENTION files (default 14). Schedule it daily (cron / Task Scheduler).
 *
 *   npm run db:backup
 *
 * Env: DATABASE_URL (required), MYSQLDUMP_PATH (optional; defaults to "mysqldump" or XAMPP's copy on Windows),
 *      BACKUP_DIR (optional), BACKUP_RETENTION (optional).
 * Restore: gunzip -c file.sql.gz | mysql -u USER -p DBNAME
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { spawn } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const url = new URL(process.env.DATABASE_URL || '');
const db = url.pathname.replace(/^\//, '').split('?')[0];
const dir = process.env.BACKUP_DIR || path.join(__dirname, '..', 'storage', 'backups');
const keep = Number(process.env.BACKUP_RETENTION || 14);
const xampp = 'C:\\xampp\\mysql\\bin\\mysqldump.exe';
const bin = process.env.MYSQLDUMP_PATH || (process.platform === 'win32' && fs.existsSync(xampp) ? xampp : 'mysqldump');

fs.mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
const file = path.join(dir, `${db}-${stamp}.sql.gz`);

const args = ['--single-transaction', '--routines', '--triggers', '--default-character-set=utf8mb4', `-h${url.hostname}`, `-P${url.port || 3306}`, `-u${decodeURIComponent(url.username)}`, db];
// Password via environment, never on the command line (visible in process lists).
const env = { ...process.env, MYSQL_PWD: decodeURIComponent(url.password || '') };

const dump = spawn(bin, args, { env });
const out = fs.createWriteStream(file);
dump.stdout.pipe(zlib.createGzip()).pipe(out);
let stderr = '';
dump.stderr.on('data', (d) => { stderr += d; });
dump.on('error', (err) => { console.error(`Could not run ${bin}: ${err.message}. Set MYSQLDUMP_PATH.`); process.exit(1); });
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
