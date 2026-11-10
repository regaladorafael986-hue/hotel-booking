// Simulated hosted checkout (PAYMENT_PROVIDER=mock). The server signs a webhook for the chosen outcome
// and processes it through the same verification path a real provider uses.
import { api } from '../api.js';
import { $, esc, params, money, loadInto, time, withLoading, toast } from '../ui.js';

const app = $('#app');
const p = params();

loadInto(app, async () => {
  let s;
  try {
    s = await api.get(`/payments/mock/sessions/${encodeURIComponent(p.session || '')}`);
  } catch (err) {
    if (err.status === 401) { location.replace(`/login.html?next=${encodeURIComponent(location.pathname + location.search)}`); return; }
    throw err;
  }
  app.innerHTML = `
    <div class="row between"><strong style="font-size:1.1rem">SimuPay Checkout</strong><span class="badge badge-warning">Test mode</span></div>
    <p class="muted small mt-1">Merchant: StayEase · Booking ${esc(s.booking_reference)} · Ref ${esc(s.payment_reference)}</p>
    <div style="font-size:2.2rem;font-weight:700;color:var(--navy);margin:16px 0">${money(s.amount)}</div>
    ${s.status !== 'PENDING' ? `<div class="alert alert-info mb-2">This session is already ${esc(s.status.toLowerCase())}.</div>` : `<p class="small muted">Hold expires at ${time(s.expires_at)}.</p>`}
    <fieldset style="border:0;padding:0;margin:0 0 18px" class="pay-options">
      <legend class="label mb-1">Pay with</legend>
      <label class="pay-option"><input type="radio" name="m" value="GCASH" checked><div><strong>GCash</strong></div></label>
      <label class="pay-option"><input type="radio" name="m" value="MAYA"><div><strong>Maya</strong></div></label>
      <label class="pay-option"><input type="radio" name="m" value="CARD"><div><strong>Credit / debit card</strong><span class="small muted">Card details would be entered on the provider's page — never on StayEase.</span></div></label>
    </fieldset>
    <div class="grid grid-2"><button class="btn btn-outline" data-outcome="failed" ${s.status !== 'PENDING' ? 'disabled' : ''}>Decline payment</button><button class="btn btn-success" data-outcome="paid" ${s.status !== 'PENDING' ? 'disabled' : ''}>Pay ${money(s.amount)}</button></div>
    <p class="center mt-2 mb-0"><a class="small" href="/payment-result.html?booking=${s.booking_id}&status=cancelled">Cancel and return to StayEase</a></p>`;
  app.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-outcome]');
    if (!b) return;
    await withLoading(b, async () => {
      try {
        const r = await api.post(`/payments/mock/sessions/${encodeURIComponent(p.session)}/complete`, { outcome: b.dataset.outcome, method: $('input[name=m]:checked').value });
        location.href = r.redirect_url;
        await new Promise(() => {});
      } catch (err) { toast(err.message, 'error'); }
    });
  });
});
