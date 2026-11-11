// Helpers for raw PostgreSQL queries.
//
// Prisma stores DateTime fields as UTC wall-clock values in `timestamp` (without time zone) columns and
// @db.Date fields in `date` columns, but it sends JS Date parameters of $queryRaw as `timestamptz`.
// Comparing the two makes PostgreSQL apply the session TimeZone setting, which silently shifts results
// whenever that setting is not UTC. These helpers convert the parameter explicitly, so raw comparisons
// never depend on the server or database time-zone configuration.
const { Prisma } = require('@prisma/client');

/** A JS Date as a UTC `timestamp`, for comparing with DateTime columns (created_at, expires_at, …). */
const utcTimestamp = (d) => Prisma.sql`(${d}::timestamptz AT TIME ZONE 'UTC')`;

/** A UTC-midnight JS Date as a `date`, for comparing with @db.Date columns (check_in, check_out, …). */
const utcDate = (d) => Prisma.sql`((${d}::timestamptz AT TIME ZONE 'UTC')::date)`;

module.exports = { utcTimestamp, utcDate };
