// booking-confirmation.html and payment-result.html.
// Payment status is read from the server (set by the verified webhook) — the redirect itself proves nothing.
import { api } from '../api.js';
import { $, esc, icon, params, money, date, plural, badge, loadInto, emptyState, withLoading, toast, time } from '../ui.js';
import { initSite } from '/components/site-shell.js';

const app = $('#app');
const p = params();
const isResult = location.pathname.includes('payment-result');
const id = p.id || p.booking;

function details(b) {
  return `<div class="card mt-3" style="max-width:760px;margin-inline:auto;text-align:left"><div class="card-body">
    <dl class="kv">
      <dt>Status</dt><dd>${badge(b.booking_status)} ${badge(b.payment_status)}</dd>
      <dt>Room</dt><dd>${b.room_summary.map((r) => `${esc(r.name)} × ${r.quantity}`).join(', ')}</dd>
      <dt>Check-in</dt><dd>${date(b.check_in)}</dd>
      <dt>Check-out</dt><dd>${date(b.check_out)} · ${plural(b.nights, 'night')}</dd>
      <dt>Guests</dt><dd>${plural(b.adults, 'adult')}${b.children ? `, ${plural(b.children, 'child', 'children')}` : ''}</dd>
      <dt>Lead guest</dt><dd>${esc(b.guest_first_name)} ${esc(b.guest_last_name)} · ${esc(b.guest_email)}</dd>
      <dt>Payment</dt><dd>${b.payment_method === 'ONLINE' ? 'Online' : 'Pay at hotel'}</dd>
    </dl>
    <hr class="divider">
    <div class="price-lines">
      <div><span>Subtotal</span><span>${money(b.subtotal)}</span></div>
      ${b.discount ? `<div class="discount"><span>Discount ${esc(b.coupon_code || '')}</span><span>− ${money(b.discount)}</span></div>` : ''}
      <div><span>Taxes</span><span>${money(b.taxes)}</span></div>
      <div class="total"><span>Total</span><span>${money(b.total_amount)}</span></div>
      ${b.amount_paid ? `<div><span>Paid</span><span>${money(b.amount_paid)}</span></div>` : ''}
      ${b.balance_due && !['CANCELLED', 'EXPIRED'].includes(b.booking_status) ? `<div><strong>Balance due${b.payment_method === 'PAY_AT_HOTEL' ? ' at the hotel' : ''}</strong><strong>${money(b.balance_due)}</strong></div>` : ''}
    </div>
  </div></div>`;
}

function actions(b) {
  const receipt = !['PENDING_PAYMENT', 'EXPIRED'].includes(b.booking_status) ? `<a class="btn btn-outline" href="${api.url(`/bookings/${b.id}/receipt`)}" target="_blank" rel="noopener">${icon('file')} ${b.payment_status === 'PAID' ? 'View receipt' : 'View confirmation'}</a>` : '';
  return `<div class="row mt-3" style="justify-content:center">${b.can_pay ? `<button class="btn btn-gold btn-lg" id="pay-now">${icon('card')} Pay ${money(b.balance_due)} now</button>` : ''}${receipt}<a class="btn" href="/customer/booking-details.html?id=${b.id}">Manage booking</a><a class="btn btn-ghost" href="/index.html">Back to home</a></div>`;
}

function heading(b) {
  const ref = `<div class="ref-box"><div class="lbl">Booking reference</div><div class="ref">${esc(b.booking_reference)}</div></div>`;
  switch (b.booking_status) {
    case 'CONFIRMED':
      return `<div class="check-circle">${icon('check')}</div><h1>Your stay is confirmed</h1>${ref}<p class="lead">We've emailed your confirmation to <strong>${esc(b.guest_email)}</strong>. Present your reference and a valid ID at check-in.</p>`;
    case 'PENDING_CONFIRMATION':
      return `<div class="check-circle" style="background:var(--warning-bg);color:var(--warning)">${icon('clock')}</div><h1>Reservation received</h1>${ref}<p class="lead">The hotel will confirm your reservation shortly. We'll notify you by email.</p>`;
    case 'PENDING_PAYMENT':
      return `<div class="check-circle" style="background:var(--warning-bg);color:var(--warning)">${icon('card')}</div><h1>${isResult && p.status === 'success' ? 'Confirming your payment…' : 'Complete your payment'}</h1>${ref}
        <p class="lead">${isResult && p.status === 'success' ? 'We are waiting for the payment provider to confirm your payment. This usually takes a few seconds.' : `Your rooms are held until <strong>${time(b.expires_at)}</strong>. Complete payment to confirm your stay.`}</p>
        ${p.pay_error ? `<div class="alert alert-danger" style="max-width:640px;margin:0 auto">${icon('alert')}<div>${esc(p.pay_error)}</div></div>` : ''}
        ${isResult && p.status === 'cancelled' ? `<div class="alert alert-warning" style="max-width:640px;margin:0 auto">${icon('info')}<div>Payment was not completed. You can try again while your hold is active.</div></div>` : ''}`;
    case 'EXPIRED':
      return `<div class="check-circle" style="background:var(--danger-bg);color:var(--danger)">${icon('clock')}</div><h1>Reservation hold expired</h1>${ref}<p class="lead">${b.payment_status === 'PAID' ? 'Your payment arrived after the hold expired. Our team has been notified and will contact you about your booking or a refund.' : 'We did not receive payment in time, so the rooms were released.'}</p>`;
    case 'CANCELLED':
      return `<div class="check-circle" style="background:var(--danger-bg);color:var(--danger)">${icon('x')}</div><h1>Reservation cancelled</h1>${ref}`;
    default:
      return `<div class="check-circle">${icon('check')}</div><h1>${esc(b.booking_status.replace('_', ' '))}</h1>${ref}`;
  }
}

let polls = 0;
async function load() {
  const { booking: b } = await api.get(`/bookings/${id}`);
  app.innerHTML = `<div class="confirm-hero">${heading(b)}</div>${actions(b)}${details(b)}`;
  $('#pay-now')?.addEventListener('click', async (e) => {
    await withLoading(e.currentTarget, async () => {
      try { const co = await api.post('/payments/checkout', { booking_id: b.id }); location.href = co.checkout_url; await new Promise(() => {}); } catch (err) { toast(err.message, 'error'); }
    });
  });
  // After a "success" redirect, poll until the webhook has confirmed (max ~40 s).
  if (isResult && p.status === 'success' && b.booking_status === 'PENDING_PAYMENT' && polls < 20) {
    polls++;
    setTimeout(() => load().catch(() => {}), 2000);
  }
}

async function main() {
  const { user } = await initSite();
  if (!user) { location.replace(`/login.html?next=${encodeURIComponent(location.pathname + location.search)}`); return; }
  if (!id) { app.innerHTML = emptyState({ icon: 'calendar', title: 'No booking specified', action: '<a class="btn" href="/customer/my-bookings.html">My bookings</a>' }); return; }
  loadInto(app, load);
}

main();
