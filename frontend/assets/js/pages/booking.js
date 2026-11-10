import { api } from '../api.js';
import { $, esc, icon, params, today, addDaysStr, nightsBetween, emptyState, loadInto, validateForm, formValues, showErrors, clearErrors, setFieldError, toast, debounce, withLoading, imgFallback } from '../ui.js';
import { initSite } from '/components/site-shell.js';
import { summaryHtml, saveDraft, loadDraft } from './booking-summary.js';

const app = $('#app');
const p = params();
let room;
let user;
let quote = null;
let appliedCoupon = '';

const opt = (n, sel, from = 0) => Array.from({ length: n - from + 1 }, (_, i) => i + from).map((i) => `<option ${Number(sel) === i ? 'selected' : ''}>${i}</option>`).join('');

function formHtml(d) {
  return `<div class="checkout-layout">
    <form id="details" class="stack" style="--stack:20px" novalidate>
      ${user.email_verified ? '' : `<div class="alert alert-warning">${icon('mail')}<div><strong>Please verify your email to complete a booking.</strong> We sent a link to ${esc(user.email)}. <button type="button" class="link-btn" id="resend">Resend link</button></div></div>`}
      <div class="card"><div class="card-head"><h2>Your stay</h2></div><div class="card-body form-grid">
        <div class="field"><label for="ci">Check-in</label><input id="ci" class="input" type="date" name="check_in" min="${today()}" value="${esc(d.check_in)}" required><div class="field-error"></div></div>
        <div class="field"><label for="co">Check-out</label><input id="co" class="input" type="date" name="check_out" min="${addDaysStr(d.check_in, 1)}" value="${esc(d.check_out)}" required><div class="field-error"></div></div>
        <div class="field"><label for="ad">Adults</label><select id="ad" class="select" name="adults" data-type="number">${opt(room.max_adults * 6, d.adults, 1)}</select><div class="field-error"></div></div>
        <div class="field"><label for="ch">Children</label><select id="ch" class="select" name="children" data-type="number">${opt(12, d.children)}</select><div class="field-error"></div></div>
        <div class="field span-2"><label for="rm">Number of ${esc(room.name)} rooms</label><select id="rm" class="select" name="rooms" data-type="number">${opt(6, d.rooms, 1)}</select><div class="hint">Each room fits up to ${room.max_adults} adults${room.max_children ? ` and ${room.max_children} child(ren)` : ''}.</div><div class="field-error"></div></div>
      </div></div>

      <div class="card"><div class="card-head"><h2>Guest details</h2><span class="small muted">Who is checking in?</span></div><div class="card-body form-grid">
        <div class="field"><label for="gf">First name</label><input id="gf" class="input" name="first_name" autocomplete="given-name" required maxlength="80" value="${esc(d.guest?.first_name ?? user.first_name)}"><div class="field-error"></div></div>
        <div class="field"><label for="gl">Last name</label><input id="gl" class="input" name="last_name" autocomplete="family-name" required maxlength="80" value="${esc(d.guest?.last_name ?? user.last_name)}"><div class="field-error"></div></div>
        <div class="field"><label for="ge">Email</label><input id="ge" class="input" type="email" name="email" autocomplete="email" required maxlength="191" value="${esc(d.guest?.email ?? user.email)}"><div class="hint">Your confirmation will be sent here.</div><div class="field-error"></div></div>
        <div class="field"><label for="gp">Mobile number</label><input id="gp" class="input" type="tel" name="phone" autocomplete="tel" required pattern="[+\\d][\\d\\s\\(\\)\\-]{6,24}" data-pattern-msg="Enter a valid phone number, e.g. +63 917 123 4567" value="${esc(d.guest?.phone ?? user.phone ?? '')}"><div class="field-error"></div></div>
        <div class="field span-2"><label for="sr">Special requests <span class="muted">(optional)</span></label><textarea id="sr" class="textarea" name="special_requests" maxlength="1000" placeholder="Early check-in, high floor, celebration…">${esc(d.special_requests || '')}</textarea><div class="hint">Requests are subject to availability.</div></div>
      </div></div>

      <div class="card"><div class="card-head"><h2>Promo code</h2></div><div class="card-body">
        <div class="field"><label for="cc" class="sr-only">Promo code</label>
          <div class="input-group"><input id="cc" class="input" name="coupon_code" maxlength="40" placeholder="e.g. WELCOME10" value="${esc(d.coupon_code || '')}" style="text-transform:uppercase"><button class="btn btn-outline" type="button" id="apply-coupon">Apply</button></div>
          <div class="field-error"></div><div class="hint" id="coupon-msg"></div>
        </div>
      </div></div>

      <div class="row between"><a class="btn btn-ghost" href="/room-details.html?id=${encodeURIComponent(room.slug)}">${icon('chevronLeft')} Back to room</a><button class="btn btn-lg" type="submit">Continue to review ${icon('arrowRight')}</button></div>
    </form>
    <div id="summary"></div>
  </div>`;
}

function payload(form) {
  const v = formValues(form);
  return {
    check_in: v.check_in, check_out: v.check_out, adults: Number(v.adults), children: Number(v.children),
    items: [{ room_type_id: room.id, quantity: Number(v.rooms) }],
    coupon_code: appliedCoupon || undefined,
    guest: { first_name: v.first_name, last_name: v.last_name, email: v.email, phone: v.phone },
    special_requests: v.special_requests,
  };
}

async function refreshQuote(form) {
  const v = formValues(form);
  if (!v.check_in || !v.check_out || v.check_out <= v.check_in) return;
  $('#summary').innerHTML = summaryHtml(room, quote, { loading: !quote });
  try {
    const { guest, special_requests, ...q } = payload(form);
    quote = await api.post('/bookings/quote', q);
    $('#summary').innerHTML = summaryHtml(room, quote);
  } catch (err) {
    quote = null;
    if (err.fields?.coupon_code) { appliedCoupon = ''; setFieldError(form, 'coupon_code', err.fields.coupon_code); return refreshQuote(form); }
    $('#summary').innerHTML = summaryHtml(room, null, { error: err.message });
  }
  imgFallback($('#summary'));
}

function bind() {
  const form = $('#details');
  const q = debounce(() => refreshQuote(form), 250);
  form.check_in.addEventListener('change', () => { form.check_out.min = addDaysStr(form.check_in.value, 1); if (form.check_out.value <= form.check_in.value) form.check_out.value = addDaysStr(form.check_in.value, 1); });
  ['check_in', 'check_out', 'adults', 'children', 'rooms'].forEach((n) => form[n].addEventListener('change', q));

  $('#apply-coupon').addEventListener('click', async (e) => {
    const code = form.coupon_code.value.trim().toUpperCase();
    clearErrors(form);
    $('#coupon-msg').textContent = '';
    if (!code) { appliedCoupon = ''; return refreshQuote(form); }
    await withLoading(e.currentTarget, async () => {
      try {
        const { guest, special_requests, ...body } = payload(form);
        quote = await api.post('/bookings/quote', { ...body, coupon_code: code });
        appliedCoupon = code;
        $('#summary').innerHTML = summaryHtml(room, quote);
        $('#coupon-msg').innerHTML = `<span style="color:var(--success)">${icon('check')} ${esc(code)} applied — you save ${quote.discount.toLocaleString('en-PH', { style: 'currency', currency: 'PHP' })}.</span>`;
      } catch (err) {
        appliedCoupon = '';
        setFieldError(form, 'coupon_code', err.fields?.coupon_code || err.message);
      }
    });
  });

  $('#resend')?.addEventListener('click', async (e) => {
    try { await withLoading(e.currentTarget, () => api.post('/auth/resend-verification')); toast('Verification email sent. Check your inbox.', 'success'); } catch (err) { toast(err.message, 'error'); }
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const ok = validateForm(form, {
      check_in: (v) => (v < today() ? 'Check-in cannot be in the past.' : ''),
      check_out: (v) => (v <= form.check_in.value ? 'Must be after check-in.' : nightsBetween(form.check_in.value, v) > 30 ? 'Maximum 30 nights.' : ''),
      rooms: (v) => (Number(v) > Number(form.adults.value) ? 'Each room needs at least one adult.' : ''),
      adults: (v) => (Number(v) > room.max_adults * Number(form.rooms.value) ? `${form.rooms.value} room(s) fit at most ${room.max_adults * Number(form.rooms.value)} adults. Add a room.` : ''),
      children: (v) => (Number(v) + Number(form.adults.value) > (room.max_adults + room.max_children) * Number(form.rooms.value) ? 'Too many guests for the selected rooms. Add a room.' : ''),
    });
    if (!ok) return;
    if (!quote) { showErrors(form, { message: 'We could not price this stay. Please check the dates and availability.', fields: {} }); return; }
    if (!user.email_verified) { showErrors(form, { message: 'Please verify your email address before continuing. Use the resend link above if needed.', fields: {} }); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    saveDraft({ room: { id: room.id, slug: room.slug, name: room.name, bed_type: room.bed_type, max_adults: room.max_adults, max_children: room.max_children, primary_image: room.primary_image }, body: payload(form), rooms: Number(form.rooms.value) });
    location.href = '/checkout.html';
  });
}

async function main() {
  ({ user } = await initSite());
  if (!user) { location.replace(`/login.html?next=${encodeURIComponent(location.pathname + location.search)}&reason=booking`); return; }
  if (user.role !== 'CUSTOMER') { app.innerHTML = emptyState({ icon: 'door', title: 'Staff accounts cannot book online', text: 'Use the front-desk walk-in screen to create reservations for guests.', action: '<a class="btn" href="/staff/walk-in.html">Open walk-in booking</a>' }); return; }
  const draft = loadDraft();
  const id = p.id || draft?.room?.slug;
  if (!id) { app.innerHTML = emptyState({ icon: 'bed', title: 'Choose a room first', action: '<a class="btn" href="/rooms.html">Browse rooms</a>' }); return; }
  loadInto(app, async () => {
    room = await api.get(`/rooms/${encodeURIComponent(id)}`);
    const fromDraft = draft && !p.check_in && draft.room.id === room.id ? { ...draft.body, rooms: draft.rooms } : {};
    appliedCoupon = fromDraft.coupon_code || '';
    const ci = p.check_in || fromDraft.check_in || today(1);
    const d = { check_in: ci, check_out: p.check_out || fromDraft.check_out || addDaysStr(ci, 2), adults: Number(p.adults || fromDraft.adults || Math.min(2, room.max_adults)), children: Number(p.children || fromDraft.children || 0), rooms: Number(p.rooms || fromDraft.rooms || 1), ...fromDraft };
    app.innerHTML = formHtml(d);
    bind();
    refreshQuote($('#details'));
  });
}

main();
