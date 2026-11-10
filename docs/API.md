# StayEase REST API (v1)

Base URL: `/api/v1` · JSON in and out · amounts in PHP (numbers with 2 decimals) · dates as `YYYY-MM-DD` (hotel-local calendar dates).

## Conventions

**Authentication.** These are server-side sessions in an `httpOnly`, `SameSite=Lax` cookie (`stayease.sid`, `Secure` in production). Log in with `POST /auth/login`.

**CSRF.** Every non-GET request must send `X-CSRF-Token`. Get the token from `GET /auth/csrf` (login and registration responses also return a fresh `csrf_token`). The only exception is `POST /payments/webhook`, which is verified by the provider's signature instead.

**Roles.** Every route below is tagged with the minimum role it requires:

- `public`: no login needed.
- `auth`: any logged-in user.
- `customer`: customer accounts.
- `staff`: receptionist or admin.
- `admin`: administrators only.
- `perm:x`: a receptionist with permission `x` (admins have every permission).

Receptionist permission keys are `check_in`, `check_out`, `assign_room`, `collect_payment`, `walk_in`, `housekeeping` and `view_customers`.

**Errors** use this shape:

```json
{ "error": { "message": "Human readable", "code": "BAD_REQUEST", "details": { "fields": { "email": "Enter a valid email address." } } } }
```

| Status | Meaning |
|---|---|
| 400 | Validation error |
| 401 | Not logged in |
| 403 | Forbidden, `CSRF` failure or `EMAIL_NOT_VERIFIED` |
| 404 | Not found (also returned for other users' bookings) |
| 409 | Conflict: sold out, invalid state transition, `BALANCE_DUE`, `ROOM_NOT_READY`, `DUPLICATE` |
| 429 | Rate limited |

**Pagination.** Use `?page=1&page_size=20`. Responses have the form `{ items, pagination: { page, page_size, total, total_pages } }`.

**Rate limits.**

| Scope | Limit |
|---|---|
| Login, register and password endpoints | 20 per 15 minutes |
| Email-sending endpoints | 6 per hour |
| The whole API | 300 per minute |

---

## Auth
| Method & path | Access | Body / notes |
|---|---|---|
| GET `/auth/csrf` | public | → `{ csrf_token }` |
| POST `/auth/register` | public | `first_name, last_name, email, phone?, password, confirm_password?` → logs in, sends verification email |
| POST `/auth/login` | public | `email, password` → `{ user, csrf_token }` (session id regenerated) |
| POST `/auth/logout` | public | destroys the session |
| GET `/auth/me` | public | `{ user }` or `{ user: null }` |
| POST `/auth/verify-email` | public | `token` |
| POST `/auth/resend-verification` | auth | |
| POST `/auth/forgot-password` | public | `email` (same response whether or not the account exists) |
| POST `/auth/reset-password` | public | `token, password` (single-use token, 1 h; signs out all sessions) |
| PUT `/auth/profile` | auth | `first_name?, last_name?, phone?` |
| PUT `/auth/password` | auth | `current_password, new_password` (signs out other sessions) |

## Hotel & rooms (public)
| Method & path | Notes |
|---|---|
| GET `/hotel` | Hotel profile, policies, check-in/out times, tax rate, photos |
| GET `/rooms` | Active room categories. Filters: `min_price, max_price, bed_type, capacity, amenities=1,2, featured` |
| GET `/rooms/filters` | Bed types and amenities that are in use |
| GET `/rooms/availability` | **Date search.** `check_in, check_out, adults, children, rooms` plus the filters above. Returns only categories with enough free physical rooms, with `available_rooms` and `stay_price` |
| GET `/rooms/:idOrSlug` | Category details with images, amenities, rating and approved reviews |
| GET `/rooms/:id/calendar?month=YYYY-MM` | Free rooms per night for a month |
| POST `/bookings/quote` | `check_in, check_out, adults, children, items:[{room_type_id, quantity}], coupon_code?` → server-computed lines, discount, taxes and total (409 if sold out) |
| GET `/offers` | Featured, currently valid promo codes |
| GET `/reviews?limit=6` | Approved reviews and the average rating |
| POST `/contact` | `name, email, phone?, subject, message` → emailed to the hotel |

## Bookings (customer)
| Method & path | Access | Notes |
|---|---|---|
| POST `/bookings` | customer (verified email) | Body as for `quote`, plus `guest:{first_name,last_name,email,phone}`, `special_requests?` and `payment_method: ONLINE \| PAY_AT_HOTEL`. `ONLINE` creates a `PENDING_PAYMENT` hold (`expires_at`). `PAY_AT_HOTEL` becomes `CONFIRMED` or `PENDING_CONFIRMATION`, depending on hotel policy. Client-sent prices are ignored. |
| GET `/bookings/my?status=all\|upcoming\|current\|completed\|cancelled` | auth | Own bookings, paginated |
| GET `/bookings/:id` | auth | Owner or staff. Includes computed `balance_due`, `can_pay`, `can_cancel`, `cancel_needs_review`, `can_review` and `suggested_refund` |
| GET `/bookings/:id/receipt[?download=1]` | auth | PDF confirmation or receipt |
| POST `/bookings/:id/cancel` | auth (owner) | `reason`. Unpaid bookings are cancelled immediately (`result: CANCELLED`); paid ones become a request (`result: REQUESTED`) |
| GET `/notifications` · POST `/notifications/:id/read` · POST `/notifications/read-all` | auth | In-app notifications |
| POST `/reviews` | customer | `booking_id, rating 1–5, title?, comment?`. Only for checked-out stays, one per booking |
| GET `/reviews/my` | auth | Your own reviews |

## Payments
| Method & path | Access | Notes |
|---|---|---|
| POST `/payments/checkout` | auth (owner) | `booking_id`. Creates (or reuses) a hosted checkout session for the outstanding balance and returns `{ checkout_url }` |
| POST `/payments/webhook` | provider | Raw body. The signature is verified (`Paymongo-Signature`, or `X-Mock-Signature` in development) and each event id is processed once. A `paid` event marks the payment PAID and confirms the booking. If the hold has lapsed, the booking is confirmed only if its rooms are still free; otherwise admins are alerted to refund |
| GET `/payments/:id` | auth | Owner or staff |
| POST `/payments/:id/refund` | admin | `amount, reason`. Uses the provider's refund API (online payments) or records a cash refund (front desk). Over-refunding is prevented under a row lock |
| GET `/payments/mock/sessions/:sid` · POST `…/complete` | auth | Development simulator only (`outcome: paid\|failed`, `method`) |

## Front desk
| Method & path | Access |
|---|---|
| GET `/staff/dashboard` | staff: today's KPIs, arrivals, departures, in-house, next 7 days |
| GET `/staff/arrivals?date=` · `/staff/departures?date=` · `/staff/in-house` | staff |
| GET `/staff/bookings?q&status&payment_status&from&to&date_field&sort&order` | staff: search |
| GET `/staff/bookings/reference/:ref` · `/staff/bookings/:id` | staff: verify a booking reference / get details |
| POST `/staff/bookings/:id/confirm` | staff |
| POST `/staff/bookings/:id/check-in` | perm:check_in. `{ override_housekeeping? }`; returns 409 `ROOM_NOT_READY` if a room isn't clean |
| POST `/staff/bookings/:id/check-out` | perm:check_out. Returns 409 `BALANCE_DUE` until the balance is paid; marks rooms `DIRTY` |
| GET `/staff/bookings/:id/assignable-rooms?booking_room_id=` · POST `/staff/bookings/:id/assign-room` | perm:assign_room. `{ booking_room_id, room_id }`, checked for overlaps under lock |
| POST `/staff/payments` | perm:collect_payment. `{ booking_id, amount, payment_method: CASH\|CARD\|GCASH\|MAYA\|BANK_TRANSFER, notes? }` (≤ balance) |
| POST `/staff/walk-ins` | perm:walk_in. Booking body plus `user_id?`, `collect_payment?:{amount,payment_method,notes}` and `check_in_now?`; returns `warnings[]` if a follow-up step couldn't complete |
| GET `/staff/rooms` · PUT `/staff/rooms/:id/housekeeping` | staff · perm:housekeeping |
| GET `/staff/customers/lookup?q=` | perm:walk_in |

## Administration (`/admin/*`, admin only)
| Area | Endpoints |
|---|---|
| Dashboard | GET `/admin/dashboard` → `{ stats, charts, recent }` |
| Hotel settings | GET/PUT `/admin/settings` · POST `/admin/settings/images` (multipart `images[]`) · DELETE `/admin/settings/images/:id` |
| Room categories | GET/POST `/admin/room-types` · GET/PUT/DELETE (archive) `/admin/room-types/:id` · POST `/admin/room-types/:id/images` · PUT `…/images/:imageId/primary` · DELETE `…/images/:imageId` |
| Physical rooms | GET/POST `/admin/rooms` · PUT/DELETE `/admin/rooms/:id` (rooms with history are deactivated; taking a room out of service is blocked while it has upcoming reservations) |
| Amenities | GET/POST `/admin/amenities` · PUT/DELETE `/admin/amenities/:id` |
| Reservations | GET `/admin/bookings` · GET `/admin/bookings/:id` · PUT `/admin/bookings/:id/status` `{status: CONFIRMED\|CANCELLED, reason?}` · POST `/admin/bookings/:id/cancellation-review` `{approve, note?, refund_amount?}` |
| Payments | GET `/admin/payments` (with totals) · GET `/admin/refunds` |
| Customers | GET `/admin/customers` · GET `/admin/customers/:id` · PUT `/admin/customers/:id/status` |
| Staff | GET/POST `/admin/staff` · PUT `/admin/staff/:id` (`permissions[]`, `account_status`, `password?`) |
| Coupons | GET/POST `/admin/coupons` · PUT/DELETE `/admin/coupons/:id` |
| Reviews | GET `/admin/reviews` · PUT `/admin/reviews/:id` `{status}` · DELETE |
| Reports | GET `/admin/reports/:name?from&to&group=day\|week\|month\|year&q&sort&order&format=json\|pdf\|xlsx`. Names: `revenue, occupancy, bookings, payments, cancellations, customers, checkins, checkouts` |
| Audit log | GET `/admin/audit-logs?q&action&from&to` |

## Status models
- **Booking:**
  - `PENDING_PAYMENT` → `CONFIRMED`, `EXPIRED` or `CANCELLED`
  - `PENDING_CONFIRMATION` → `CONFIRMED` or `CANCELLED`
  - `CONFIRMED` → `CHECKED_IN` → `CHECKED_OUT`
- **Payment status** (kept separate from booking status): `PENDING`, `PAID`, `FAILED`, `PARTIALLY_REFUNDED`, `REFUNDED`.
- **Cancellation request:** `NONE` → `REQUESTED` → `APPROVED` or `REJECTED`.
