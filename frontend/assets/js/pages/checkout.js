import { api } from '../api.js';
import { $, esc, icon, date, plural, emptyState, loadInto, showErrors, withLoading, validateForm, imgFallback } from '../ui.js';
import { initSite } from '/components/site-shell.js';
import { summaryHtml, loadDraft, clearDraft } from './booking-summary.js';

const app = $('#app');
let draft;
let quote;
let hotel;

function render() {
  const b = draft.body;
  app.innerHTML = `<div class="checkout-layout">
    <form id="pay-form" class="stack" style="--stack:20px" novalidate>
      <div class="card"><div class="card-head"><h2>Review your reservation</h2><a class="small" href="/booking.html?id=${encodeURIComponent(draft.room.slug)}">Edit details</a></div><div class="card-body">
        <dl class="kv">
          <dt>Room</dt><dd>${esc(draft.room.name)} × ${draft.rooms}</dd>
          <dt>Dates</dt><dd>${date(b.check_in)} → ${date(b.check_out)} (${plural(quote.nights, 'night')})</dd>
          <dt>Guests</dt><dd>${plural(b.adults, 'adult')}${b.children ? `, ${plural(b.children, 'child', 'children')}` : ''}</dd>
          <dt>Lead guest</dt><dd>${esc(b.guest.first_name)} ${esc(b.guest.last_name)}<br><span class="muted small">${esc(b.guest.email)} · ${esc(b.guest.phone)}</span></dd>
          ${b.special_requests ? `<dt>Requests</dt><dd>${esc(b.special_requests)}</dd>` : ''}
          <dt>Check-in / out</dt><dd>From ${esc(hotel?.check_in_time || '14:00')} · until ${esc(hotel?.check_out_time || '12:00')}</dd>
        </dl>
      </div></div>

      <div class="card"><div class="card-head"><h2>Payment method</h2></div><div class="card-body">
        <fieldset class="pay-options field" style="border:0;padding:0;margin:0">
          <legend class="sr-only">Payment method</legend>
          <label class="pay-option"><input type="radio" name="payment_method" value="ONLINE" required checked>
            <div><strong>Pay online now</strong><span class="small muted">Secure hosted checkout. Your rooms are held for ${hotel?.hold_minutes ?? 15} minutes while you pay.</span>
            <div class="pay-logos"><span>GCash</span><span>Maya</span><span>VISA</span><span>Mastercard</span></div></div></label>
          <label class="pay-option"><input type="radio" name="payment_method" value="PAY_AT_HOTEL">
            <div><strong>Pay at the hotel</strong><span class="small muted">Reserve now and pay at the front desk on arrival${hotel?.pay_at_hotel_auto_confirm === false ? '. Your reservation will be confirmed by the hotel shortly' : ''}.</span></div></label>
          <div class="field-error"></div>
        </fieldset>
        <p class="small muted mt-2 mb-0">${icon('lock')} We never see or store your card details — payment is handled by our PCI-compliant payment partner.</p>
      </div></div>

      <div class="card"><div class="card-body stack">
        <h3>Cancellation policy</h3>
        <p class="small mb-0 policy-text">${esc(hotel?.cancellation_policy || 'Free cancellation up to 48 hours before check-in.')}</p>
        <div class="field"><label class="check"><input type="checkbox" name="agree" required data-required-msg="Please accept the hotel policies to continue."> <span>I agree to the <a href="/policies.html" target="_blank">hotel policies</a> and cancellation terms.</span></label><div class="field-error"></div></div>
      </div></div>

      <div class="row between"><a class="btn btn-ghost" href="/booking.html?id=${encodeURIComponent(draft.room.slug)}">${icon('chevronLeft')} Back</a><button class="btn btn-gold btn-lg" type="submit" id="confirm-btn">${icon('lock')} Confirm reservation</button></div>
    </form>
    <div id="summary">${summaryHtml(draft.room, quote)}</div>
  </div>`;
  imgFallback(app);

  const form = $('#pay-form');
  const btn = $('#confirm-btn');
  form.addEventListener('change', () => { btn.innerHTML = `${icon('lock')} ${form.payment_method.value === 'ONLINE' ? `Confirm & pay ${quote.total.toLocaleString('en-PH', { style: 'currency', currency: 'PHP' })}` : 'Confirm reservation'}`; });
  form.dispatchEvent(new Event('change'));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!validateForm(form)) return;
    const method = form.payment_method.value;
    await withLoading(btn, async () => {
      try {
        const { booking } = await api.post('/bookings', { ...draft.body, payment_method: method });
        clearDraft();
        if (method === 'ONLINE') {
          try {
            const co = await api.post('/payments/checkout', { booking_id: booking.id });
            location.href = co.checkout_url;
          } catch (err) {
            // Booking exists and is on hold; send the guest to it so they can retry payment.
            location.href = `/booking-confirmation.html?id=${booking.id}&pay_error=${encodeURIComponent(err.message)}`;
          }
        } else location.href = `/booking-confirmation.html?id=${booking.id}`;
        await new Promise(() => {}); // keep the button busy while navigating
      } catch (err) {
        if (err.code === 'EMAIL_NOT_VERIFIED') err.message += ' Check your inbox for the verification link.';
        if (err.status === 409) err.message += ' Your details are saved — go back to choose different dates or rooms.';
        showErrors(form, err);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });
  });
}

async function main() {
  let user;
  ({ user, hotel } = await initSite());
  if (!user) { location.replace(`/login.html?next=${encodeURIComponent('/checkout.html')}`); return; }
  draft = loadDraft();
  if (!draft) { app.innerHTML = emptyState({ icon: 'calendar', title: 'Your booking session has expired', text: 'Please choose your room and dates again.', action: '<a class="btn" href="/rooms.html">Browse rooms</a>' }); return; }
  loadInto(app, async () => {
    const { guest, special_requests, ...q } = draft.body;
    try {
      quote = await api.post('/bookings/quote', q);
    } catch (err) {
      app.innerHTML = `<div class="alert alert-danger mb-3">${icon('alert')}<div>${esc(err.message)}</div></div><a class="btn" href="/booking.html?id=${encodeURIComponent(draft.room.slug)}">Change your stay</a>`;
      return;
    }
    render();
  }, { loadingText: 'Re-checking price and availability…' });
}

main();
