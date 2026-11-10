# StayEase — Hotel Booking & Reservation Management System

StayEase is a web-based booking and operations platform for **one hotel**. Guests browse rooms, check live availability, book and pay online (GCash, Maya, cards) or choose *Pay at Hotel*. Staff run the front desk, and administrators manage the hotel, rooms, reservations, payments, promotions, reviews and reports.

| Layer | Technology |
|---|---|
| Frontend | HTML5, CSS3 (custom design system), vanilla JavaScript ES modules, Fetch API, Chart.js |
| Backend | Node.js 20+ (tested on 26), Express 5, REST API at `/api/v1` |
| Database | MySQL / MariaDB via Prisma ORM (migrations in `backend/prisma/migrations`) |
| Security | bcrypt, server-side sessions in MySQL, CSRF tokens, RBAC + staff permissions, Helmet CSP, rate limiting, zod validation |
| Services | Brevo (email), Cloudinary (images), PayMongo (payments), pdfkit/exceljs (exports) |

> **Status of third-party integrations.** Brevo, Cloudinary and PayMongo are implemented against their REST APIs but are **not live until you add credentials**. Without them the app runs fully in development mode: emails print to the server console (and are saved to `backend/storage/outbox/`), images are stored on local disk, and payments use a built-in **simulated provider** that signs its webhooks exactly like a real one. The simulator is refused when `NODE_ENV=production`.

---

## Features

**Guests / customers**: homepage with live search, featured rooms, offers and reviews · room listing with date availability and filters (price, category, bed, capacity, amenities) · room details with gallery, availability calendar and policies · registration, login, email verification, password reset · 4-step booking with server-priced quote and promo codes · online payment or pay at hotel · confirmation and PDF receipts · dashboard, booking history, cancellation (instant if unpaid, reviewed if paid), reviews, notifications, profile and password.

**Receptionists**: front-desk dashboard · booking-reference verification · arrivals and departures with one-click check-in/out · room assignment and reassignment · payment collection (cash/card/GCash/Maya/bank) · walk-in reservations · housekeeping board · permission-based access.

**Administrators**: KPI dashboard with revenue, occupancy, trend, payment-method and room-popularity charts · hotel settings and photos · room categories (pricing, amenities, images, archive) · physical rooms (floor, housekeeping, maintenance, activation) · reservations (confirm, cancel, review cancellation requests, refunds) · customers · staff accounts and permissions · payments and refunds · promotions and coupons · review moderation · 8 reports with date filters, search, sorting, print, PDF and Excel export · activity (audit) log.

### How availability works
Every reservation line is assigned a **physical room** (`booking_rooms.room_id`). A room is unavailable for a stay when an *active* booking assigned to it overlaps:

```
existing.check_in < requested.check_out AND existing.check_out > requested.check_in
```

Active means pending-confirmation, confirmed, checked-in, or awaiting payment with an unexpired hold. Cancelled, expired and checked-out bookings never block inventory. Booking creation runs in a `READ COMMITTED` transaction that takes `SELECT … FOR UPDATE` row locks on the affected room categories (in id order, to avoid deadlocks). Prices are recomputed from the database, free rooms are picked, and all rooms of a multi-room booking are inserted atomically. A background job expires unpaid holds every minute and releases their rooms and coupon usage. The automated tests verify that 8 simultaneous requests for 2 rooms yield exactly 2 bookings.

---

## Quick start (local, Windows + XAMPP)

**Prerequisites:** Node.js 20+ and XAMPP (only its **MySQL/MariaDB** is used; no PHP).

1. **Start MySQL** in the XAMPP Control Panel (default `root` with no password on port 3306).
2. **Install dependencies**
   ```bash
   cd backend
   npm install
   ```
   With npm 11+, approve Prisma's install scripts if you're prompted: `npm install-scripts approve @prisma/client @prisma/engines prisma`, then `npm rebuild`.
3. **Configure the environment**
   ```bash
   cp .env.example .env
   ```
   Set `SESSION_SECRET` to a long random string. The default `DATABASE_URL` points at `mysql://root:@localhost:3306/stayease_db`.
4. **Create the database and tables**
   ```bash
   npm run db:migrate             # creates stayease_db if missing and applies all migrations
   npm run db:seed                # demo hotel, rooms, accounts and ~4 months of history
   ```
   (`db:migrate` may also run the seed automatically on first run; running it again is safe because it resets to the demo data.)
5. **Run**
   ```bash
   npm run dev                    # http://localhost:4000 (auto-restarts on changes)
   ```
   Express serves both the API (`/api/v1`) and the frontend from the same origin.

### Demo accounts (seed data)
| Role | Email | Password |
|---|---|---|
| Administrator | admin@stayease.test | Admin@12345 |
| Receptionist | frontdesk@stayease.test | Staff@12345 |
| Receptionist (limited permissions) | night.audit@stayease.test | Staff@12345 |
| Customer | guest@stayease.test | Guest@12345 |

Promo codes: `WELCOME10` (10%, max ₱2,500) and `STAYLONGER` (₱1,500 off ₱15,000+).

### Trying a payment locally
Book a room and choose **Pay online now**. You'll be sent to the *development payment simulator*: click **Pay** to send a signed `paid` webhook, or **Decline payment** to send a `failed` one. The booking is confirmed only when the webhook is verified. The browser redirect never confirms anything.

---

## Configuration

All settings live in `backend/.env` (see `backend/.env.example`). Secrets never reach the frontend.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | MySQL connection string |
| `SESSION_SECRET` | Signs session cookies (required in production) |
| `APP_URL` | Public base URL used in emails and payment redirects |
| `HOTEL_TIMEZONE` | Determines "today" for arrivals, reports and holds (default `Asia/Manila`) |
| `REQUIRE_EMAIL_VERIFICATION_FOR_BOOKING` | Customers must verify their email before booking (default `true`) |
| `BREVO_API_KEY`, `MAIL_FROM_EMAIL`, `MAIL_FROM_NAME` | Transactional email via Brevo |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Image hosting (otherwise local `storage/uploads`) |
| `PAYMENT_PROVIDER` | `mock` (development only) or `paymongo` |
| `PAYMONGO_SECRET_KEY`, `PAYMONGO_WEBHOOK_SECRET`, `PAYMONGO_LIVE_MODE` | PayMongo Checkout + webhook signature verification |
| `TRUST_PROXY` | Set `true` behind a reverse proxy so secure cookies and client IPs work |
| `RUN_JOBS` | Enables the hold-expiry and reminder jobs (run them on one instance only) |

### Enabling PayMongo (GCash, Maya, cards)
1. Create a PayMongo account and copy the **secret key** (test mode first).
2. In the PayMongo dashboard, register a webhook to `https://YOUR_DOMAIN/api/v1/payments/webhook` for the events `checkout_session.payment.paid`, `payment.failed` and `payment.refund.updated`, and copy its **signing secret**.
3. Set `PAYMENT_PROVIDER=paymongo`, `PAYMONGO_SECRET_KEY`, `PAYMONGO_WEBHOOK_SECRET`, then restart the server.
4. Run a test-mode payment end to end before switching to live keys (`PAYMONGO_LIVE_MODE=true`). Field names follow PayMongo's documented Checkout Session API; verify them against PayMongo's current documentation during that test.

---

## Scripts (`backend/`)
| Command | Description |
|---|---|
| `npm run dev` / `npm start` | Start the server (watch mode / plain) |
| `npm run db:migrate` | Create and apply a new migration in development |
| `npm run db:deploy` | Apply migrations (production) |
| `npm run db:seed` | Reset all data to the demo dataset (**refused in production**) |
| `npm run db:backup` | Gzipped `mysqldump` to `storage/backups` with retention |
| `npm test` | API and integration tests against a separate `stayease_test` database |

## Project structure
```
frontend/                 Static site served by Express
  index.html, rooms.html, room-details.html, booking.html, checkout.html, …
  customer/ admin/ staff/ Role areas (thin HTML shells rendered by page modules)
  components/             Reusable UI: site shell, dashboard shell, data table, booking panel, charts, forms
  assets/css/             base.css (design system) · site.css (public site) · dashboard.css
  assets/js/              api.js (fetch + CSRF) · ui.js · session.js · icons.js · pages/**
backend/
  src/app.js, server.js   Express app (security middleware, static hosting) and bootstrap
  src/config/             env + Prisma client
  src/routes/             REST routes with validation and role/permission guards
  src/controllers/        Thin HTTP handlers
  src/services/           Business logic (availability, pricing, booking, payment, reports, …)
  src/services/payments/  PayMongo + mock providers
  src/middleware/         auth/RBAC, CSRF, validation, errors, rate limits, uploads
  src/validators/         zod schemas
  src/jobs/               hold expiry, check-in reminders
  prisma/                 schema.prisma, migrations, seed.js
  scripts/backup-db.js    database backup
  tests/                  node:test + supertest integration tests
docs/                     API reference, testing and deployment guides
```

## Further documentation
- [docs/API.md](docs/API.md): REST API reference
- [docs/TESTING.md](docs/TESTING.md): automated tests, manual QA checklist and results
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md): production deployment, HTTPS and backups
