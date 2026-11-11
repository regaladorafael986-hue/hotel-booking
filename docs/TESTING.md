# Testing

## Automated tests (`backend/tests`)

```bash
cd backend
npm test
```

The suite uses Node's built-in test runner and supertest against the real Express app and a **separate local PostgreSQL database, `stayease_test`**. It is migrated automatically; override it with `TEST_DATABASE_URL`. Every run deletes all rows, so the suite refuses any database that is not on this machine (it can never reach Neon), and it never touches `stayease_db`.

**Last run: 39 tests, 39 passed, 0 failed** (`api.test.js` 18, `oauth.test.js` 10, `postgres.test.js` 5, `serverless.test.js` 6), with the database time zone set to UTC, Asia/Manila and America/Los_Angeles.

| Area | What is verified |
|---|---|
| Authentication | Register → session → logout → login; bcrypt hashes; weak password, duplicate email and wrong password rejected; CSRF token required on every state-changing request; email-verification and reset tokens are single-use; forgot-password doesn't reveal which emails exist |
| Roles | Customer blocked from `/admin` and `/staff`; receptionist blocked from `/admin`; per-permission receptionist checks; anonymous users blocked from bookings |
| Booking engine | Pay-at-hotel booking confirmed; **client-sent totals ignored** and recomputed server-side; availability decreases; back-to-back stays (check-in on the previous guest's check-out day) don't conflict |
| Concurrency | **8 simultaneous requests for 2 rooms → exactly 2 bookings, 6 × 409, two distinct physical rooms** |
| PostgreSQL | Raw availability SQL returns correct columns; hold expiry and back-to-back stays are correct whatever the database time zone; revenue grouped by Manila day; case-insensitive search; duplicate values reported as 409 with the field name |
| Vercel mode | App loaded through `frontend/api/index.js`: API routes work; pages are left to the CDN; holds expire on demand; `/api/cron/:job` requires `CRON_SECRET` and runs the daily jobs without creating sessions; uploads need Cloudinary; rate-limit counters are shared through the database |
| Atomicity | A 3-room request with 2 free rooms fails with nothing reserved; a 2-room booking spreads guests across rooms |
| Validation | Past dates, check-out before check-in, over-capacity, unverified email |
| Privacy | Customer B gets 404 for customer A's booking |
| Coupons | Percentage discount with cap, server-side math, usage limit enforced |
| Online payment | Hold → checkout (session reused) → **forged webhook rejected (400)** → signed webhook confirms → **replayed event is a no-op** |
| Hold expiry | Expiry job releases the room; another guest books it; a late payment does **not** confirm the expired booking, is recorded as PAID and raises an admin alert |
| Front desk | Check-in; check-out blocked with `BALANCE_DUE`; over-collection rejected; payment recorded; check-out marks rooms DIRTY; receipt PDF; review only after stay; duplicate review blocked |
| Room assignment | Reassigning to a room taken for overlapping dates → 409 |
| Cancellation | Unpaid → instant; paid → request → admin approval with refund → CANCELLED + REFUNDED; over-refund rejected |
| Social sign-in | Provider calls stubbed: state + PKCE on start; forged and replayed `state` rejected; new Google user created verified and logged in with no password; repeat sign-in reuses the account; password login refused for social-only accounts, which can set a password; the only sign-in method can't be disconnected; existing account linked only on a Google-verified email (Facebook refused); new Facebook user gets a verification email; staff refused; missing email refused; link from profile; `?next` open redirect ignored |
| Reports | Dashboard figures from live data; all 8 reports return rows; PDF and XLSX exports are valid files; audit log records actions |

## Browser end-to-end checks (performed during development)

These were run in headless Chrome against the seeded database.

1. **Guest booking:** log in, open room details (live calendar and availability), go to booking, apply `WELCOME10` (₱1,180 off), submit checkout without accepting the policies (validation shown), accept and pay online, pay on the simulator, then see the result page show **"Your stay is confirmed"** (via the webhook, not the redirect).
2. **Front desk:** submitting an empty walk-in form shows validation errors. A walk-in with a partial payment and "check in now" against a dirty room creates the reservation with a warning. Check-in with the override works; check-out with a balance opens the payment modal; collecting the balance allows check-out. Marking the room clean on the housekeeping board works.
3. **Admin:** create a room category and a room; a duplicate room number shows an inline error. A coupon over 100% is blocked, then a valid one is created. Approving a cancellation request with a refund shows *Cancelled · Refunded*. The occupancy report exports to PDF.
4. **Page crawl:** all 28 dashboard pages (admin, receptionist, customer) load with no console errors or failed API calls.
5. **Responsive check:** 31 pages checked at 390 px width with no horizontal overflow (after fixing grid min-width on room details).

## Manual QA checklist (before release)
- [ ] Register a new account, receive the verification email (Brevo configured), verify, book.
- [ ] Forgot password → email → reset → old sessions logged out.
- [ ] Online payment in **PayMongo test mode** for GCash, Maya and card; failed payment; abandoned checkout expires after the hold window.
- [ ] Refund an online payment through PayMongo and confirm the `payment.refund.updated` webhook.
- [ ] Image upload to Cloudinary (room category and hotel photos).
- [ ] Two browsers booking the last room at the same time: one succeeds, one sees "fully booked".
- [ ] Receptionist with limited permissions cannot collect payments or create walk-ins.
- [ ] Deactivated customer or staff accounts are signed out immediately.
- [ ] Reports: print preview, PDF and Excel open correctly.
- [ ] Mobile: booking flow on a phone; front desk on a tablet.
- [ ] Keyboard-only navigation of the booking flow; screen-reader labels on forms.

## Known limitations
- Google and Facebook sign-in are tested with stubbed provider responses; run one real sign-in with each after adding keys.
- PayMongo, Brevo and Cloudinary integrations follow their published REST APIs but have **not** been exercised with live credentials in this environment.
- Room rates are a single base price per category (no seasonal or weekend pricing).
- Background jobs run in-process; with multiple app instances, enable `RUN_JOBS` on only one of them.
