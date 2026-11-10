import { api } from '../../api.js';
import { $, esc, icon, money, today, addDaysStr, nightsBetween, plural, validateForm, formValues, showErrors, withLoading, toast, debounce, setFieldError, emptyState } from '../../ui.js';
import { initDashboard } from '/components/dashboard-shell.js';
import { can } from '../../session.js';
import { bookingHref } from './common.js';

const app = $('#app');
const user = await initDashboard({ area: 'RECEPTIONIST', active: 'walk-in', title: 'Walk-in booking' });
if (!can(user, 'walk_in')) {
  app.innerHTML = emptyState({ icon: 'lock', title: 'Permission required', text: 'Your account is not allowed to create walk-in reservations.' });
  throw new Error('no permission');
}

let types = [];
let quote = null;
let linkedUser = null;
const opt = (n, sel, from = 0) => Array.from({ length: n - from + 1 }, (_, i) => i + from).map((i) => `<option ${Number(sel) === i ? 'selected' : ''}>${i}</option>`).join('');

app.innerHTML = `<div class="page-head"><div><h1>Walk-in reservation</h1><p>Create a booking for a guest at the front desk.</p></div></div>
<form id="wf" novalidate>
  <div class="checkout-layout">
    <div class="stack" style="--stack:20px">
      <section class="card"><div class="card-head"><h2>1 · Stay</h2></div><div class="card-body form-grid">
        <div class="field"><label for="ci">Check-in</label><input id="ci" class="input" type="date" name="check_in" min="${today()}" value="${today()}" required><div class="field-error"></div></div>
        <div class="field"><label for="co">Check-out</label><input id="co" class="input" type="date" name="check_out" min="${today(1)}" value="${today(1)}" required><div class="field-error"></div></div>
        <div class="field"><label for="ad">Adults</label><select id="ad" class="select" name="adults">${opt(20, 2, 1)}</select><div class="field-error"></div></div>
        <div class="field"><label for="ch">Children</label><select id="ch" class="select" name="children">${opt(12, 0)}</select></div>
      </div></section>

      <section class="card"><div class="card-head"><h2>2 · Room</h2><span class="small muted" id="avail-sub"></span></div><div class="card-body">
        <div id="types" class="pay-options"></div>
        <div class="field mt-2"><label for="qty">Number of rooms</label><select id="qty" class="select" name="quantity" style="max-width:160px"><option>1</option></select><div class="field-error"></div></div>
      </div></section>

      <section class="card"><div class="card-head"><h2>3 · Guest</h2></div><div class="card-body stack">
        <div class="field" style="position:relative"><label for="lookup">Find existing customer <span class="muted">(optional)</span></label><input id="lookup" class="input" placeholder="Search name, email or phone" autocomplete="off"><div class="dropdown" id="lookup-results" style="left:0;right:auto;width:100%"></div><div class="hint" id="linked"></div></div>
        <div class="form-grid">
          <div class="field"><label for="gf">First name</label><input id="gf" class="input" name="first_name" required maxlength="80"><div class="field-error"></div></div>
          <div class="field"><label for="gl">Last name</label><input id="gl" class="input" name="last_name" required maxlength="80"><div class="field-error"></div></div>
          <div class="field"><label for="ge">Email</label><input id="ge" class="input" type="email" name="email" required maxlength="191"><div class="hint">The confirmation is sent here.</div><div class="field-error"></div></div>
          <div class="field"><label for="gp">Phone</label><input id="gp" class="input" type="tel" name="phone" required pattern="[+\\d][\\d\\s\\(\\)\\-]{6,24}" data-pattern-msg="Enter a valid phone number."><div class="field-error"></div></div>
          <div class="field span-2"><label for="sr">Special requests</label><textarea id="sr" class="textarea" name="special_requests" maxlength="1000" style="min-height:70px"></textarea></div>
        </div>
      </div></section>

      <section class="card"><div class="card-head"><h2>4 · Payment &amp; arrival</h2></div><div class="card-body stack">
        ${can(user, 'collect_payment') ? `<label class="check"><input type="checkbox" name="collect" id="collect"> <span>Collect payment now</span></label>
        <div class="form-grid hidden" id="pay-fields">
          <div class="field"><label for="amt">Amount (₱)</label><input id="amt" class="input" type="number" name="amount" min="0.01" step="0.01"><div class="field-error"></div></div>
          <div class="field"><label for="pm">Method</label><select id="pm" class="select" name="payment_method"><option value="CASH">Cash</option><option value="CARD">Card (terminal)</option><option value="GCASH">GCash</option><option value="MAYA">Maya</option><option value="BANK_TRANSFER">Bank transfer</option></select></div>
          <div class="field span-2"><label for="pn">Payment notes</label><input id="pn" class="input" name="payment_notes" maxlength="255" placeholder="OR number / approval code"></div>
        </div>` : '<p class="small muted mb-0">Payment will be collected later by a colleague with payment permission.</p>'}
        ${can(user, 'check_in') ? '<label class="check"><input type="checkbox" name="check_in_now" id="cin"> <span>Check the guest in immediately (arrival today only)</span></label>' : ''}
      </div></section>
    </div>
    <aside>
      <div class="card summary-card"><div class="card-head"><h2>Summary</h2></div><div class="card-body" id="sum"><p class="muted mb-0">Choose dates and a room to see the price.</p></div>
      <div class="card-body" style="border-top:1px solid var(--gray)"><button class="btn btn-gold btn-lg btn-block" type="submit">${icon('check')} Create reservation</button></div></div>
    </aside>
  </div>
</form>`;

const form = $('#wf');
const selectedType = () => Number(form.querySelector('input[name=room_type_id]:checked')?.value) || null;

async function loadTypes() {
  const v = formValues(form);
  const box = $('#types');
  if (!v.check_in || !v.check_out || v.check_out <= v.check_in) { box.innerHTML = '<p class="muted">Choose valid dates.</p>'; return; }
  box.innerHTML = '<div class="skeleton" style="height:120px"></div>';
  try {
    const r = await api.get('/rooms/availability', { check_in: v.check_in, check_out: v.check_out, adults: 1, children: 0, rooms: 1 });
    types = r.items;
    $('#avail-sub').textContent = `${plural(r.search.nights, 'night')} · live availability`;
    const prev = selectedType();
    box.innerHTML = types.length ? types.map((t) => `<label class="pay-option"><input type="radio" name="room_type_id" value="${t.id}" ${t.id === prev ? 'checked' : ''} required data-required-msg="Choose a room category."><div style="flex:1"><div class="row between"><strong>${esc(t.name)}</strong><span>${money(t.base_price)}<span class="small muted"> / night</span></span></div><span class="small muted">${esc(t.bed_type)} · up to ${t.max_adults} adults${t.max_children ? ` + ${t.max_children} children` : ''} · <strong style="color:${t.available_rooms <= 2 ? 'var(--warning)' : 'var(--success)'}">${t.available_rooms} free</strong></span></div></label>`).join('') + '<div class="field-error"></div>'
      : '<div class="alert alert-danger">No rooms are available for these dates.</div>';
    syncQty();
  } catch (err) { box.innerHTML = `<div class="alert alert-danger">${esc(err.message)}</div>`; }
}

function syncQty() {
  const t = types.find((x) => x.id === selectedType());
  const max = t ? Math.min(t.available_rooms, 10) : 1;
  const cur = Math.min(Number(form.quantity.value) || 1, max);
  form.quantity.innerHTML = opt(max, cur, 1);
}

function body() {
  const v = formValues(form);
  return {
    check_in: v.check_in, check_out: v.check_out, adults: Number(v.adults), children: Number(v.children),
    items: [{ room_type_id: selectedType(), quantity: Number(v.quantity) }],
    guest: { first_name: v.first_name, last_name: v.last_name, email: v.email, phone: v.phone },
    special_requests: v.special_requests,
  };
}

const refreshQuote = debounce(async () => {
  const sum = $('#sum');
  if (!selectedType()) return;
  const { guest, special_requests, ...b } = body();
  try {
    quote = await api.post('/bookings/quote', b);
    sum.innerHTML = `<dl class="kv small mb-2"><dt>Room</dt><dd>${esc(quote.lines[0].name)} × ${quote.total_rooms}</dd><dt>Stay</dt><dd>${plural(quote.nights, 'night')}</dd><dt>Guests</dt><dd>${quote.adults + quote.children}</dd></dl>
      <div class="price-lines"><div><span>Subtotal</span><span>${money(quote.subtotal)}</span></div><div><span>Taxes (${quote.tax_rate}%)</span><span>${money(quote.taxes)}</span></div><div class="total"><span>Total</span><span>${money(quote.total)}</span></div></div>`;
    if (form.amount && !form.amount.dataset.touched) form.amount.value = quote.total;
    if (form.amount) form.amount.max = quote.total;
  } catch (err) {
    quote = null;
    sum.innerHTML = `<div class="alert alert-danger">${icon('alert')}<div>${esc(err.message)}</div></div>`;
  }
}, 250);

form.check_in.addEventListener('change', () => {
  form.check_out.min = addDaysStr(form.check_in.value, 1);
  if (form.check_out.value <= form.check_in.value) form.check_out.value = addDaysStr(form.check_in.value, 1);
  if (form.check_in_now) { form.check_in_now.disabled = form.check_in.value !== today(); if (form.check_in_now.disabled) form.check_in_now.checked = false; }
});
form.addEventListener('change', (e) => {
  if (['check_in', 'check_out'].includes(e.target.name)) loadTypes().then(refreshQuote);
  if (e.target.name === 'room_type_id') { syncQty(); refreshQuote(); }
  if (['adults', 'children', 'quantity'].includes(e.target.name)) refreshQuote();
  if (e.target.id === 'collect') $('#pay-fields').classList.toggle('hidden', !e.target.checked);
});
form.amount?.addEventListener('input', () => { form.amount.dataset.touched = '1'; });

// Customer lookup
const lookup = $('#lookup');
const results = $('#lookup-results');
lookup.addEventListener('input', debounce(async () => {
  const q = lookup.value.trim();
  if (q.length < 2) { results.classList.remove('open'); return; }
  try {
    const { items } = await api.get('/staff/customers/lookup', { q });
    results.innerHTML = items.length ? items.map((u) => `<button type="button" data-u='${esc(JSON.stringify(u))}'><span><strong>${esc(u.first_name)} ${esc(u.last_name)}</strong><br><span class="small muted">${esc(u.email)}${u.phone ? ` · ${esc(u.phone)}` : ''}</span></span></button>`).join('') : '<div class="dd-head small muted">No matching customers — enter details below.</div>';
    results.classList.add('open');
  } catch { results.classList.remove('open'); }
}, 300));
results.addEventListener('click', (e) => {
  const b = e.target.closest('[data-u]');
  if (!b) return;
  linkedUser = JSON.parse(b.dataset.u);
  form.first_name.value = linkedUser.first_name;
  form.last_name.value = linkedUser.last_name;
  form.email.value = linkedUser.email;
  form.phone.value = linkedUser.phone || '';
  $('#linked').innerHTML = `${icon('check')} Linked to customer account ${esc(linkedUser.email)} · <button type="button" class="link-btn" id="unlink">unlink</button>`;
  results.classList.remove('open');
  lookup.value = '';
});
$('#linked').addEventListener('click', (e) => { if (e.target.id === 'unlink') { linkedUser = null; $('#linked').innerHTML = ''; } });
document.addEventListener('click', (e) => { if (!e.target.closest('#lookup, #lookup-results')) results.classList.remove('open'); });

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const collect = form.collect?.checked;
  const ok = validateForm(form, {
    check_out: (v) => (v <= form.check_in.value ? 'Must be after check-in.' : nightsBetween(form.check_in.value, v) > 30 ? 'Maximum 30 nights.' : ''),
    amount: (v) => (collect && !(Number(v) > 0) ? 'Enter the amount received.' : collect && quote && Number(v) > quote.total ? `Cannot exceed ${money(quote.total)}.` : ''),
  });
  if (!ok) return;
  if (!selectedType()) { setFieldError(form, 'room_type_id', 'Choose a room category.'); return; }
  const v = formValues(form);
  const payload = {
    ...body(),
    ...(linkedUser ? { user_id: linkedUser.id } : {}),
    ...(collect ? { collect_payment: { amount: Number(v.amount), payment_method: v.payment_method, notes: v.payment_notes } } : {}),
    check_in_now: Boolean(form.check_in_now?.checked),
  };
  await withLoading(form.querySelector('[type=submit]'), async () => {
    try {
      const r = await api.post('/staff/walk-ins', payload);
      toast(`${r.message} Reference ${r.booking.booking_reference}.`, r.warnings?.length ? 'error' : 'success', 9000);
      if (r.warnings?.length) sessionStorage.setItem('se.flash', r.message);
      location.href = bookingHref(user, r.booking.id);
      await new Promise(() => {});
    } catch (err) {
      showErrors(form, err);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });
});

loadTypes();
