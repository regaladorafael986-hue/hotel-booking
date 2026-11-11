// PostgreSQL schema that holds StayEase's tables. Set DATABASE_SCHEMA (e.g. "stayease") when the database is
// shared with other data; unset means the default "public" schema. The same value is applied to the runtime
// client (src/config/prisma.js), to Prisma CLI commands (scripts/prisma.js) and to raw SQL (utils/sql.js tbl()).
const NAME = /^[a-z_][a-z0-9_]{0,62}$/;

function dbSchema() {
  const s = process.env.DATABASE_SCHEMA || 'public';
  if (!NAME.test(s)) throw new Error(`DATABASE_SCHEMA "${s}" is not a valid schema name (lowercase letters, digits, underscores).`);
  return s;
}

/** The connection string with Prisma's `schema` parameter set to DATABASE_SCHEMA (unchanged when it is not set). */
function withSchema(url) {
  if (!url || !process.env.DATABASE_SCHEMA) return url;
  const u = new URL(url);
  u.searchParams.set('schema', dbSchema());
  return u.toString();
}

module.exports = { dbSchema, withSchema };
