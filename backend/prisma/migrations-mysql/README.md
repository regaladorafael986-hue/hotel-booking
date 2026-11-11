# Archived MySQL migrations (history only)

StayEase originally ran on MySQL/MariaDB. These are the migrations that built that schema.
They are kept for reference and are **never applied**: Prisma only reads `prisma/migrations/`,
which now holds the PostgreSQL baseline (`0_init`) that recreates the same tables, enums,
indexes, unique keys and foreign keys.

The last MySQL version of the code is tagged `mysql-final` in Git.
