// Shared order-summary card for booking.html and checkout.html (numbers always come from the server quote).
import { esc, money, date, plural, icon } from '../ui.js';
import { roomImage } from '/components/room-card.js';

export function summaryHtml(room, quote, { loading = false, error = '' } = {}) {
  const q = quote;
  return `<div class="card summary-card"><div class="card-body">
    <div class="thumb"><img src="${esc(roomImage(room, 700))}" alt="${esc(room.name)}" data-fallback></div>
    <h3 class="serif" style="font-size:1.5rem;margin-bottom:4px">${esc(room.name)}</h3>
    <p class="small muted">${esc(room.bed_type)} · up to ${room.max_adults + room.max_children} guests per room</p>
    ${q ? `<dl class="kv small mb-2">
        <dt>Check-in</dt><dd>${date(q.check_in)}</dd>
        <dt>Check-out</dt><dd>${date(q.check_out)}</dd>
        <dt>Stay</dt><dd>${plural(q.nights, 'night')} · ${plural(q.total_rooms, 'room')}</dd>
        <dt>Guests</dt><dd>${plural(q.adults, 'adult')}${q.children ? `, ${plural(q.children, 'child', 'children')}` : ''}</dd>
      </dl>
      <div class="price-lines">
        ${q.lines.map((l) => `<div><span>${money(l.nightly_rate)} × ${plural(l.nights, 'night')}${l.quantity > 1 ? ` × ${l.quantity}` : ''}</span><span>${money(l.amount)}</span></div>`).join('')}
        ${q.discount ? `<div class="discount"><span>Promo ${esc(q.coupon?.code || '')}</span><span>− ${money(q.discount)}</span></div>` : ''}
        <div><span>Taxes &amp; fees (${q.tax_rate}%)</span><span>${money(q.taxes)}</span></div>
        <div class="total"><span>Total</span><span>${money(q.total)}</span></div>
      </div>` : loading ? '<div class="skeleton" style="height:160px"></div>' : ''}
    ${error ? `<div class="alert alert-danger mt-2">${icon('alert')}<div>${esc(error)}</div></div>` : ''}
    <p class="small muted mt-2 mb-0">${icon('shield')} Prices are calculated securely by the hotel and include all taxes.</p>
  </div></div>`;
}

const KEY = 'se.bookingDraft';
export const saveDraft = (d) => sessionStorage.setItem(KEY, JSON.stringify({ ...d, savedAt: Date.now() }));
export function loadDraft() {
  try {
    const d = JSON.parse(sessionStorage.getItem(KEY) || 'null');
    return d && Date.now() - d.savedAt < 3600_000 ? d : null;
  } catch { return null; }
}
export const clearDraft = () => sessionStorage.removeItem(KEY);
