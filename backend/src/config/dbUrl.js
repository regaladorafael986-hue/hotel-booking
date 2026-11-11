// PostgreSQL schema that holds StayEase's tables. Set DATABASE_SCHEMA (e.g. "stayease") when the database is
// shared with other data; unset means the default "public" schema. The same value is applied to the runtime
// client (src/config/prisma.js), to Prisma CLI commands (scripts/prisma.js) and to raw SQL (utils/sql.js tbl()).
//
// Note: through Neon's pooler (PgBouncer, transaction mode) the session search_path is NOT kept, so the schema
// parameter only works because Prisma qualifies every ORM query with the schema, and tbl() does the same for
// raw SQL. Never write raw SQL with bare table names.
const NAME = /^[a-z_][a-z0-9_]{0,62}$/;
const DEFAULT_CONNECT_TIMEOUT_S = '15'; // Prisma's default is 5s; a suspended Neon compute can take longer to wake

const schemaSet = () => Boolean((process.env.DATABASE_SCHEMA || '').trim());

// Startup guard: on Vercel the Neon database also holds another app's tables in "public", some with the same
// names as StayEase's. Never fall back to "public" there; refuse to start until DATABASE_SCHEMA is set.
// This module is loaded by src/config/prisma.js (and scripts/prisma.js), so the API fails before any query.
if (process.env.VERCEL && !schemaSet()) {
  throw new Error('DATABASE_SCHEMA must be set on Vercel (e.g. "stayease"). Refusing to start: without it StayEase would use the "public" schema, which holds other data.');
}

function dbSchema() {
  if (process.env.VERCEL && !schemaSet()) throw new Error('DATABASE_SCHEMA must be set on Vercel; refusing to fall back to "public".');
  const s = process.env.DATABASE_SCHEMA || 'public';
  if (!NAME.test(s)) throw new Error(`DATABASE_SCHEMA "${s}" is not a valid schema name (lowercase letters, digits, underscores).`);
  return s;
}

/**
 * The connection string as StayEase uses it: Prisma's `schema` parameter set to DATABASE_SCHEMA (when set) and a
 * connect_timeout (when the URL has none). Returned unchanged when there is nothing to add.
 */
function withSchema(url) {
  if (!url) return url;
  const u = new URL(url);
  let changed = false;
  if (process.env.DATABASE_SCHEMA) { u.searchParams.set('schema', dbSchema()); changed = true; }
  if (/\.neon\.tech$/i.test(u.hostname) && !u.searchParams.has('connect_timeout')) { u.searchParams.set('connect_timeout', DEFAULT_CONNECT_TIMEOUT_S); changed = true; }
  return changed ? u.toString() : url;
}

module.exports = { dbSchema, withSchema };
