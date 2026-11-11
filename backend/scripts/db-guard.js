/**
 * Guards that keep destructive database commands (reset, demo seed wipe, test fixtures) away from
 * real data. A database counts as "local" only when its host is this machine.
 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

const isLocalUrl = (url) => Boolean(url) && LOCAL_HOSTS.has(hostOf(url));

/** Every connection string Prisma may use for this process (queries use DATABASE_URL, migrate uses DATABASE_URL_UNPOOLED). */
const configuredUrls = () => [process.env.DATABASE_URL, process.env.DATABASE_URL_UNPOOLED].filter(Boolean);

/** Throws unless every configured database URL points at this machine. */
function assertLocalDatabase(action) {
  const remote = configuredUrls().filter((u) => !isLocalUrl(u));
  if (remote.length) {
    throw new Error(`Refusing to ${action}: it is destructive and the database host "${hostOf(remote[0])}" is not local. ` +
      'Run it only against a database on this machine.');
  }
}

module.exports = { isLocalUrl, hostOf, assertLocalDatabase, configuredUrls };

// CLI: `node scripts/db-guard.js "<action>" && <destructive command>` — exits 1 unless the database is local.
if (require.main === module) {
  require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
  try {
    assertLocalDatabase(process.argv[2] || 'run this command');
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
