# Deployment guide

StayEase runs on **Vercel** (pages + API) with a **Neon PostgreSQL** database, both on one domain.

- The existing pages in `frontend/` are served by Vercel's CDN.
- The existing Express API (`backend/src/app.js`) runs as one Vercel Function, `frontend/api/index.js`. `frontend/vercel.json` sends every `/api/*` request to it, so all API paths stay the same and no CORS is needed.
- The Vercel project's **Root Directory is `frontend`**. The build installs `backend/` and copies the pages into `frontend/dist`.

> GitHub Pages cannot host StayEase: it serves static files only, so the API, logins and bookings would not work.

## 1. Database (Neon)
Connect the Neon database to the Vercel project (Vercel → **Storage** → the Neon database → **Connect Project**). The integration sets:
- `DATABASE_URL`: pooled connection (`-pooler` host), used by the app at runtime
- `DATABASE_URL_UNPOOLED`: direct connection, used only by `prisma migrate`

Turn on **database branches for Preview deployments** if offered, so preview deployments never write to production data.

### Migrations (never reset)
`npm run db:deploy` (`prisma migrate deploy`) only applies migrations that have not run yet. It never drops, resets or truncates. Run it from `backend/` with the Neon URLs in `backend/.env`, or set `MIGRATE_ON_BUILD=true` for the **Production** environment only, so each production build applies pending migrations. Preview builds never migrate.

Check first with `npm run db:status`. If the database already contains the StayEase tables from before migrations were tracked, mark the baseline as applied instead of running it: `npx prisma migrate resolve --applied 0_init`.

The destructive commands (`db:reset`, `db:migrate`, `db:seed`, `npm test`) refuse to run against any database that is not on the local machine.

### First data
- **Demo hotel:** `SEED_DEMO_DATA=true SEED_ADMIN_PASSWORD=… SEED_STAFF_PASSWORD=… npm run db:seed:prod` loads the demo data **only if the database is empty**. The passwords must be 10+ characters; the README passwords never work online.
- **Real hotel:** create the first administrator, then sign in and fill in **Hotel settings**, room categories and rooms:
  ```bash
  node -e "const b=require('bcryptjs'),p=require('./src/config/prisma');b.hash(process.argv[1],12).then(h=>p.user.create({data:{firstName:'Admin',lastName:'User',email:process.argv[2],passwordHash:h,role:'ADMIN',emailVerifiedAt:new Date()}})).then(()=>process.exit())" '<password>' admin@yourhotel.com
  ```

## 2. Environment variables (Vercel → Settings → Environment Variables)
| Variable | Value |
|---|---|
| `SESSION_SECRET` | 64+ random characters (required; the API will not start without it) |
| `CRON_SECRET` | 32+ random characters; enables the scheduled jobs |
| `APP_URL` | `https://www.yourhotel.com` in Production (previews use their own URL automatically) |
| `HOTEL_TIMEZONE` | `Asia/Manila` (default) |
| `PAYMENT_PROVIDER` | `paymongo` with `PAYMONGO_SECRET_KEY`, `PAYMONGO_WEBHOOK_SECRET`, `PAYMONGO_LIVE_MODE=true`; or, for a demo only, `mock` with `ALLOW_MOCK_PAYMENTS=true` and a random `MOCK_WEBHOOK_SECRET` |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Required for image uploads on Vercel (its disk is read-only) |
| `BREVO_API_KEY`, `MAIL_FROM_EMAIL`, `MAIL_FROM_NAME` | Email delivery. Without it emails are only logged, so set `REQUIRE_EMAIL_VERIFICATION_FOR_BOOKING=false` or guests cannot book |
| `GOOGLE_CLIENT_ID/SECRET`, `FACEBOOK_APP_ID/SECRET` | Optional social sign-in; redirect URI `{APP_URL}/api/v1/auth/oauth/<provider>/callback` |

`TRUST_PROXY` defaults to 1 hop on Vercel, which makes secure cookies and client IPs work. Vercel sets `NODE_ENV=production`, so cookies are `Secure` and the security checks in `backend/src/config/env.js` apply.

## 3. Scheduled jobs
Vercel has no always-running process, so:
- **Vercel Cron** calls `GET /api/cron/daily` once a day (01:00 UTC = 09:00 Manila; see `crons` in `frontend/vercel.json`) with `Authorization: Bearer <CRON_SECRET>`. It expires lapsed holds, sends next-day check-in reminders and deletes expired sessions and rate-limit rows. Cron runs on Production deployments only.
- **Unpaid holds** also expire on demand: at most once a minute per instance, an API request runs the expiry first. Availability never depends on this, because lapsed holds stop blocking rooms the moment they expire.
- Individual jobs: `/api/cron/expire-holds`, `/api/cron/check-in-reminders`, `/api/cron/cleanup`. On the Pro plan you can add a more frequent `expire-holds` cron.

The local server (`npm start`) still runs these jobs on timers.

## 4. Domain (Cloudflare DNS)
Vercel → project → **Settings → Domains** → add the domain, then in Cloudflare DNS create the record Vercel shows (CNAME to `cname.vercel-dns.com`, flattened at the apex). Set the record to **DNS only** (grey cloud): Vercel issues the certificate and terminates HTTPS. Then set `APP_URL` to the domain.

## 5. Payment webhooks
In the PayMongo dashboard, register `https://www.yourhotel.com/api/v1/payments/webhook` for `checkout_session.payment.paid`, `payment.failed` and `payment.refund.updated`, and copy its secret into `PAYMONGO_WEBHOOK_SECRET`. Events are signature-verified on the raw body, de-duplicated and logged in `payment_events`. Preview deployments are behind Vercel login, so providers can only reach Production.

## 6. Backups
Neon keeps point-in-time restore history. For an extra offline copy, run `npm run db:backup` from a machine with `pg_dump` installed; it reads `DATABASE_URL_UNPOOLED` and never changes the database. Restore only into an empty database: `gunzip -c file.sql.gz | psql "<url>"`.

## 7. Release checklist
- [ ] `npm test` passes (local PostgreSQL)
- [ ] Preview deployment checked: login, booking, checkout and webhook, admin and front-desk pages
- [ ] `SESSION_SECRET`, `CRON_SECRET` and `APP_URL` set for Production
- [ ] PayMongo live keys and webhook secret set; one real low-value payment and refund verified
- [ ] Brevo sender verified; test email received
- [ ] Cloudinary keys set; an image upload works
- [ ] Admin password changed from any temporary value
- [ ] Monitoring on `GET /api/health`

## Other hosts
The same app runs on any Node 20+ host with PostgreSQL: `cd backend && npm ci && npm run db:deploy && npm start` (serves the pages and the API on one port, with timers for the jobs). Behind a reverse proxy set `TRUST_PROXY=true`. The MySQL version of StayEase is tagged `mysql-final` in Git.
