import { api } from '../api.js';
import { $, esc, icon, params, money, moneyShort, loadInto, emptyState, stars, today, addDaysStr, nightsBetween, plural, date, validateForm, formValues, setFieldError, imgFallback } from '../ui.js';
import { amenityIcon } from '../icons.js';
import { initSite } from '/components/site-shell.js';
import { roomMeta } from '/components/room-card.js';

const p = params();
const root = $('#room');
let room;
let hotel;
let calMonth = today().slice(0, 7);

function gallery(images) {
  if (!images.length) return '<div class="img-frame wide skeleton"></div>';
  const shown = images.slice(0, 5);
  return `<div class="gallery">${shown.map((img, i) => `<button type="button" data-img="${i}" aria-label="Open photo ${i + 1} of ${images.length}"><img src="${esc(img.image_url)}" alt="${esc(room.name)} photo ${i + 1}" ${i ? 'loading="lazy"' : ''} data-fallback>${i === shown.length - 1 && images.length > shown.length ? `<span class="more">+${images.length - shown.length} photos</span>` : ''}</button>`).join('')}</div>`;
}

function lightbox(start) {
  const imgs = room.images;
  let i = start;
  const el = document.createElement('div');
  el.className = 'lightbox';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Photo viewer');
  const render = () => { el.innerHTML = `<img src="${esc(imgs[i].image_url)}" alt="${esc(room.name)} photo ${i + 1}"><button class="lb-btn close" aria-label="Close">${icon('x')}</button>${imgs.length > 1 ? `<button class="lb-btn prev" aria-label="Previous">${icon('chevronLeft')}</button><button class="lb-btn next" aria-label="Next">${icon('chevronRight')}</button>` : ''}<div class="caption">${i + 1} / ${imgs.length}</div>`; };
  const close = () => { el.remove(); document.removeEventListener('keydown', key); document.body.classList.remove('no-scroll'); };
  const go = (d) => { i = (i + d + imgs.length) % imgs.length; render(); };
  const key = (e) => { if (e.key === 'Escape') close(); if (e.key === 'ArrowRight') go(1); if (e.key === 'ArrowLeft') go(-1); };
  el.addEventListener('click', (e) => {
    if (e.target.closest('.close') || e.target === el) close();
    else if (e.target.closest('.prev')) go(-1);
    else if (e.target.closest('.next')) go(1);
  });
  document.addEventListener('keydown', key);
  render();
  document.body.appendChild(el);
  document.body.classList.add('no-scroll');
  el.querySelector('.close').focus();
}

async function renderCalendar() {
  const box = $('#calendar');
  box.innerHTML = '<div class="skeleton" style="height:260px"></div>';
  try {
    const { days } = await api.get(`/rooms/${room.id}/calendar`, { month: calMonth });
    const first = new Date(`${calMonth}-01T00:00:00Z`);
    const pad = (first.getUTCDay() + 6) % 7;
    const t = today();
    const label = first.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    const atStart = calMonth <= t.slice(0, 7);
    box.innerHTML = `<div class="cal-head"><button class="btn btn-ghost btn-icon" data-cal="-1" aria-label="Previous month" ${atStart ? 'disabled' : ''}>${icon('chevronLeft')}</button><strong>${label}</strong><button class="btn btn-ghost btn-icon" data-cal="1" aria-label="Next month">${icon('chevronRight')}</button></div>
      <div class="cal-grid">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => `<div class="cal-dow">${d}</div>`).join('')}
      ${'<div class="cal-day empty"></div>'.repeat(pad)}
      ${days.map((d) => {
        const past = d.date < t;
        const cls = past ? 'past' : d.available === 0 ? 'full' : d.available <= 2 ? 'low' : '';
        return `<div class="cal-day ${cls}" title="${past ? '' : `${d.available} of ${d.total} rooms free`}">${Number(d.date.slice(8))}${past ? '' : `<small>${d.available} left</small>`}</div>`;
      }).join('')}</div>
      <div class="cal-legend"><span class="l-ok">Available</span><span class="l-low">Few left</span><span class="l-full">Sold out</span></div>`;
  } catch (err) {
    box.innerHTML = `<p class="muted">Availability calendar unavailable: ${esc(err.message)}</p>`;
  }
}

function bookingBox() {
  const ci = p.check_in || today(1);
  const co = p.check_out || addDaysStr(ci, 2);
  const opt = (n, sel, from = 0) => Array.from({ length: n - from + 1 }, (_, i) => i + from).map((i) => `<option ${Number(sel) === i ? 'selected' : ''}>${i}</option>`).join('');
  return `<aside class="card booking-box"><div class="card-body">
    <div class="row between mb-2"><div><span class="price-big">${moneyShort(room.base_price)}</span> <span class="muted">/ night</span></div>${room.rating?.average ? `<span class="small">${stars(Math.round(room.rating.average))} ${room.rating.average}</span>` : ''}</div>
    <form id="book-form" class="stack" novalidate>
      <div class="grid grid-2" style="gap:10px">
        <div class="field"><label for="b-in">Check-in</label><input id="b-in" class="input" type="date" name="check_in" min="${today()}" value="${ci}" required><div class="field-error"></div></div>
        <div class="field"><label for="b-out">Check-out</label><input id="b-out" class="input" type="date" name="check_out" min="${addDaysStr(ci, 1)}" value="${co}" required><div class="field-error"></div></div>
        <div class="field"><label for="b-ad">Adults</label><select id="b-ad" class="select" name="adults">${opt(room.max_adults * 4, p.adults || Math.min(2, room.max_adults), 1)}</select></div>
        <div class="field"><label for="b-ch">Children</label><select id="b-ch" class="select" name="children">${opt(room.max_children * 4 + room.max_adults, p.children || 0)}</select></div>
        <div class="field" style="grid-column:1/-1"><label for="b-rm">Rooms</label><select id="b-rm" class="select" name="rooms">${opt(Math.max(1, Math.min(6, room.room_count || 1)), p.rooms || 1, 1)}</select><div class="field-error"></div></div>
      </div>
      <div id="box-status" class="small" aria-live="polite"></div>
      <button class="btn btn-gold btn-lg btn-block" type="submit">Reserve</button>
      <p class="small muted center mb-0">You won't be charged yet. Free cancellation up to ${hotel?.free_cancellation_hours ?? 48} hours before check-in.</p>
    </form>
  </div></aside>`;
}

async function checkBox() {
  const f = $('#book-form');
  const v = formValues(f);
  const status = $('#box-status');
  if (!v.check_in || !v.check_out || v.check_out <= v.check_in) { status.innerHTML = ''; return null; }
  status.innerHTML = '<span class="muted">Checking availability…</span>';
  try {
    const r = await api.get('/rooms/availability', { ...v, room_type_id: room.id });
    const hit = r.items.find((i) => i.id === room.id);
    if (!hit) { status.innerHTML = `<span class="avail none">${icon('alert')} Not available for these dates / guests.</span>`; return false; }
    status.innerHTML = `<div class="price-lines"><div><span>${moneyShort(room.base_price)} × ${plural(r.search.nights, 'night')}${Number(v.rooms) > 1 ? ` × ${v.rooms} rooms` : ''}</span><strong>${money(hit.stay_price)}</strong></div><div class="muted"><span>Taxes (${hotel?.tax_rate ?? 12}%) added at checkout</span></div><div><span class="avail ${hit.available_rooms <= 2 ? 'low' : 'ok'}">${hit.available_rooms <= 2 ? `Only ${hit.available_rooms} left` : `${icon('check')} Available`}</span></div></div>`;
    return true;
  } catch (err) {
    status.innerHTML = `<span class="avail none">${esc(err.message)}</span>`;
    return false;
  }
}

function render() {
  const policies = hotel?.hotel_policies || '';
  root.innerHTML = `
    <div class="breadcrumbs dark mb-2"><a href="/index.html">Home</a> / <a href="/rooms.html">Rooms</a> / ${esc(room.name)}</div>
    <div class="row between mb-3"><div><h1 class="mb-0">${esc(room.name)}</h1><p class="lead mb-0">${esc(room.short_description || '')}</p></div></div>
    ${gallery(room.images)}
    <div class="detail-layout">
      <div class="stack" style="--stack:2.5rem">
        <div class="facts">
          <div><div class="lbl">Category</div><div class="val">${esc(room.name)}</div></div>
          <div><div class="lbl">Guests</div><div class="val">${room.max_adults} adults${room.max_children ? ` + ${room.max_children} child${room.max_children > 1 ? 'ren' : ''}` : ''}</div></div>
          <div><div class="lbl">Bed</div><div class="val">${esc(room.bed_type)}</div></div>
          ${room.size_sqm ? `<div><div class="lbl">Size</div><div class="val">${room.size_sqm} m²</div></div>` : ''}
        </div>
        <section><h2>About this room</h2><p class="policy-text">${esc(room.description || room.short_description || '')}</p>${roomMeta(room)}</section>
        <section><h2>Amenities</h2><div class="feature-grid">${room.amenities.map((a) => `<div class="feature">${amenityIcon(a.icon)}<span>${esc(a.name)}</span></div>`).join('') || '<p class="muted">Amenities to be announced.</p>'}</div></section>
        <section><h2>Availability</h2><p class="muted">Live availability for this category across all ${room.room_count || ''} rooms.</p><div class="card"><div class="card-body calendar" id="calendar"></div></div></section>
        <section><h2>Hotel policies</h2>
          <dl class="kv mb-2"><dt>Check-in</dt><dd>From ${esc(hotel?.check_in_time || '14:00')}</dd><dt>Check-out</dt><dd>Until ${esc(hotel?.check_out_time || '12:00')}</dd></dl>
          ${policies ? `<p class="policy-text">${esc(policies)}</p>` : ''}
          ${hotel?.cancellation_policy ? `<h3 class="mt-2">Cancellation</h3><p class="policy-text">${esc(hotel.cancellation_policy)}</p>` : ''}
        </section>
        <section><h2>Guest reviews</h2>${room.reviews.length
          ? `<div class="rating-summary mb-2"><span class="score">${room.rating.average}</span><div>${stars(Math.round(room.rating.average))}<div class="small muted">${plural(room.rating.count, 'review')}</div></div></div><div class="grid grid-2">${room.reviews.map((r) => `<figure class="review-card">${stars(r.rating)}${r.title ? `<strong>${esc(r.title)}</strong>` : ''}<blockquote style="font-size:1.05rem">${esc(r.comment || '')}</blockquote><figcaption class="who"><span class="avatar">${esc(r.guest_name.charAt(0))}</span>${esc(r.guest_name)} · <span class="muted">${date(r.created_at, { month: 'short', year: 'numeric' })}</span></figcaption></figure>`).join('')}</div>`
          : emptyState({ icon: 'star', title: 'No reviews yet', text: 'Reviews appear here after guests complete their stay.' })}</section>
      </div>
      ${bookingBox()}
    </div>`;
  document.title = `${room.name} — StayEase`;
  imgFallback(root);

  root.querySelector('.gallery')?.addEventListener('click', (e) => { const b = e.target.closest('[data-img]'); if (b) lightbox(Number(b.dataset.img)); });
  root.addEventListener('click', (e) => {
    const c = e.target.closest('[data-cal]');
    if (!c) return;
    const d = new Date(`${calMonth}-01T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + Number(c.dataset.cal));
    calMonth = d.toISOString().slice(0, 7);
    renderCalendar();
  });
  const form = $('#book-form');
  const ci = form.check_in;
  const co = form.check_out;
  ci.addEventListener('change', () => { co.min = addDaysStr(ci.value, 1); if (co.value <= ci.value) co.value = addDaysStr(ci.value, 1); });
  form.addEventListener('change', checkBox);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const ok = validateForm(form, {
      check_in: (v) => (v < today() ? 'Check-in cannot be in the past.' : ''),
      check_out: (v) => (v <= ci.value ? 'Must be after check-in.' : nightsBetween(ci.value, v) > 30 ? 'Maximum 30 nights.' : ''),
    });
    if (!ok) return;
    const v = formValues(form);
    if (Number(v.rooms) > Number(v.adults)) return setFieldError(form, 'rooms', 'Each room needs at least one adult.');
    if (!(await checkBox())) return;
    location.href = `/booking.html?${new URLSearchParams({ id: room.slug, ...v })}`;
  });
  renderCalendar();
  checkBox();
}

async function main() {
  ({ hotel } = await initSite());
  if (!p.id) { root.innerHTML = emptyState({ icon: 'bed', title: 'Room not specified', action: '<a class="btn" href="/rooms.html">Browse rooms</a>' }); return; }
  loadInto(root, async () => {
    try {
      room = await api.get(`/rooms/${encodeURIComponent(p.id)}`);
    } catch (err) {
      if (err.status === 404) { root.innerHTML = emptyState({ icon: 'bed', title: 'Room not found', text: 'This room may no longer be available.', action: '<a class="btn" href="/rooms.html">Browse rooms</a>' }); return; }
      throw err;
    }
    render();
  }, { loadingText: 'Loading room…' });
}

main();
