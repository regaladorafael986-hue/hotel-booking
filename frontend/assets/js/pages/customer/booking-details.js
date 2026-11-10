import { api } from '../../api.js';
import { $, esc, icon, params, money, date, dateTime, time, plural, badge, loadInto, confirmDialog, toast, withLoading, emptyState } from '../../ui.js';
import { initDashboard } from '/components/dashboard-shell.js';
import { reviewDialog } from './common.js';

const app = $('#app');
const id = params().id;
await initDashboard({ area: 'CUSTOMER', active: 'bookings', title: 'Booking details' });

function cancellationBlock(b) {
  if (b.cancellation_status === 'REQUESTED') return `<div class="alert alert-warning">${icon('clock')}<div><strong>Cancellation requested</strong> on ${dateTime(b.cancellation_requested_at)}. The hotel is reviewing your request${b.amount_paid ? ' and any eligible refund' : ''}.<br><span class="small">Reason: ${esc(b.cancellation_reason)}</span></div></div>`;
  if (b.cancellation_status === 'REJECTED') return `<div class="alert alert-danger">${icon('x')}<div><strong>Cancellation request declined.</strong>${b.cancellation_note ? ` ${esc(b.cancellation_note)}` : ''} Please contact the hotel if you have questions.</div></div>`;
  if (b.booking_status === 'CANCELLED') return `<div class="alert alert-danger">${icon('info')}<div><strong>Cancelled</strong> on ${dateTime(b.cancelled_at)}.${b.cancellation_reason ? ` Reason: ${esc(b.cancellation_reason)}.` : ''}${b.cancellation_note ? ` Note from the hotel: ${esc(b.cancellation_note)}` : ''}${b.amount_refunded ? ` Refunded: <strong>${money(b.amount_refunded)}</strong>.` : ''}</div></div>`;
  return '';
}

function render(b) {
  const timeline = [
    ['Booked', b.created_at], ['Confirmed', b.confirmed_at], ['Checked in', b.checked_in_at], ['Checked out', b.checked_out_at],
    ['Cancellation requested', b.cancellation_requested_at], ['Cancelled', b.cancelled_at],
  ].filter(([, t]) => t).sort((x, y) => new Date(x[1]) - new Date(y[1]));
  const receiptOk = !['PENDING_PAYMENT', 'EXPIRED'].includes(b.booking_status);
  app.innerHTML = `
    <div class="page-head">
      <div><a class="small" href="/customer/my-bookings.html">${icon('chevronLeft')} My bookings</a><h1>${esc(b.booking_reference)}</h1><div class="row mt-1">${badge(b.booking_status)} ${badge(b.payment_status)} ${b.cancellation_status === 'REQUESTED' ? badge('REQUESTED') : ''}</div></div>
      <div class="actions no-print">
        ${receiptOk ? `<a class="btn btn-outline" href="${api.url(`/bookings/${b.id}/receipt`, { download: 1 })}">${icon('download')} Download receipt</a><button class="btn btn-outline" id="print">${icon('printer')} Print</button>` : ''}
      </div>
    </div>
    ${b.can_pay ? `<div class="alert alert-warning mb-3" id="pay">${icon('card')}<div style="flex:1"><strong>Payment required.</strong> Your rooms are held until ${time(b.expires_at)}. Complete payment to confirm this booking.</div><button class="btn btn-gold" id="pay-btn">Pay ${money(b.balance_due)}</button></div>` : ''}
    ${b.booking_status === 'PENDING_CONFIRMATION' ? `<div class="alert alert-info mb-3">${icon('clock')}<div>The hotel will confirm this reservation shortly. Payment will be collected at the front desk.</div></div>` : ''}
    <div class="mb-3">${cancellationBlock(b)}</div>
    <div class="detail-grid">
      <div class="stack" style="--stack:20px">
        <section class="card"><div class="card-head"><h2>Stay</h2></div><div class="card-body">
          <dl class="kv">
            <dt>Check-in</dt><dd>${date(b.check_in)}</dd>
            <dt>Check-out</dt><dd>${date(b.check_out)} · ${plural(b.nights, 'night')}</dd>
            <dt>Rooms</dt><dd>${b.rooms.map((r) => `${esc(r.room_type.name)}${['CHECKED_IN', 'CHECKED_OUT'].includes(b.booking_status) ? ` · Room ${esc(r.room.room_number)}` : ''} <span class="muted small">(${plural(r.adults, 'adult')}${r.children ? `, ${plural(r.children, 'child', 'children')}` : ''})</span>`).join('<br>')}</dd>
            <dt>Guests</dt><dd>${plural(b.adults, 'adult')}${b.children ? `, ${plural(b.children, 'child', 'children')}` : ''}</dd>
            <dt>Lead guest</dt><dd>${esc(b.guest_first_name)} ${esc(b.guest_last_name)}<br><span class="small muted">${esc(b.guest_email)}${b.guest_phone ? ` · ${esc(b.guest_phone)}` : ''}</span></dd>
            ${b.special_requests ? `<dt>Special requests</dt><dd>${esc(b.special_requests)}</dd>` : ''}
          </dl>
        </div></section>
        <section class="card"><div class="card-head"><h2>Payments</h2></div>
          ${b.payments.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Reference</th><th>Date</th><th>Method</th><th>Status</th><th class="num">Amount</th></tr></thead><tbody>
            ${b.payments.map((p) => `<tr><td>${esc(p.payment_reference)}</td><td>${dateTime(p.paid_at || p.created_at)}</td><td>${esc(p.payment_method || (p.provider === 'FRONT_DESK' ? 'Front desk' : 'Online'))}</td><td>${badge(p.payment_status)}</td><td class="num">${money(p.amount)}</td></tr>
              ${p.refunds.map((r) => `<tr><td colspan="2" class="small muted">↳ Refund ${dateTime(r.created_at)} — ${esc(r.reason || '')}</td><td></td><td>${badge(r.refund_status)}</td><td class="num">− ${money(r.amount)}</td></tr>`).join('')}`).join('')}
          </tbody></table></div>` : `<div class="card-body muted">${b.payment_method === 'PAY_AT_HOTEL' ? 'No payments yet — you will pay at the front desk.' : 'No payments yet.'}</div>`}
        </section>
        ${b.review ? `<section class="card"><div class="card-head"><h2>Your review</h2>${badge(b.review.status === 'APPROVED' ? 'APPROVED' : b.review.status === 'REJECTED' ? 'REJECTED' : 'PENDING', b.review.status === 'PENDING' ? 'Awaiting moderation' : null)}</div><div class="card-body"><span class="stars">${'★'.repeat(b.review.rating)}<span class="off">${'★'.repeat(5 - b.review.rating)}</span></span>${b.review.title ? `<h3 class="mt-1">${esc(b.review.title)}</h3>` : ''}<p class="mb-0">${esc(b.review.comment || '')}</p></div></section>` : ''}
      </div>
      <aside class="stack" style="--stack:20px">
        <section class="card"><div class="card-head"><h2>Price summary</h2></div><div class="card-body price-lines">
          ${b.room_summary.map((r) => `<div><span>${esc(r.name)} × ${r.quantity} × ${plural(b.nights, 'night')}</span><span>${money(r.nightly_rate * r.quantity * b.nights)}</span></div>`).join('')}
          ${b.discount ? `<div class="discount"><span>Discount ${esc(b.coupon_code || '')}</span><span>− ${money(b.discount)}</span></div>` : ''}
          <div><span>Taxes</span><span>${money(b.taxes)}</span></div>
          <div class="total"><span>Total</span><span>${money(b.total_amount)}</span></div>
          <div><span>Paid</span><span>${money(b.amount_paid)}</span></div>
          ${b.amount_refunded ? `<div><span>Refunded</span><span>− ${money(b.amount_refunded)}</span></div>` : ''}
          ${b.balance_due && !['CANCELLED', 'EXPIRED'].includes(b.booking_status) ? `<div><strong>Balance due</strong><strong>${money(b.balance_due)}</strong></div>` : ''}
        </div></section>
        <section class="card no-print"><div class="card-head"><h2>Manage</h2></div><div class="card-body action-stack">
          ${b.can_review ? `<button class="btn btn-gold" id="review-btn">${icon('star')} Review your stay</button>` : ''}
          ${b.can_cancel ? `<button class="btn btn-outline" id="cancel-btn" style="color:var(--danger)">${b.cancel_needs_review ? 'Request cancellation' : 'Cancel booking'}</button><p class="small muted mb-0">${b.cancel_needs_review ? (b.within_free_cancellation ? 'You are within the free-cancellation window; eligible refunds are returned to your original payment method.' : 'You are outside the free-cancellation window. Refunds are at the hotel\'s discretion.') : 'This unpaid booking will be cancelled immediately.'}</p>` : ''}
          <a class="btn btn-ghost" href="/contact.html">${icon('msg')} Contact the hotel</a>
        </div></section>
        <section class="card"><div class="card-head"><h2>Timeline</h2></div><div class="card-body"><ul class="timeline">${timeline.map(([l, t]) => `<li><strong>${l}</strong><time>${dateTime(t)}</time></li>`).join('')}</ul></div></section>
      </aside>
    </div>`;

  $('#print')?.addEventListener('click', () => window.print());
  $('#pay-btn')?.addEventListener('click', async (e) => {
    await withLoading(e.currentTarget, async () => {
      try { const co = await api.post('/payments/checkout', { booking_id: b.id }); location.href = co.checkout_url; await new Promise(() => {}); } catch (err) { toast(err.message, 'error'); }
    });
  });
  $('#review-btn')?.addEventListener('click', async () => { if (await reviewDialog(b)) load(); });
  $('#cancel-btn')?.addEventListener('click', async () => {
    const reason = await confirmDialog({
      title: b.cancel_needs_review ? 'Request cancellation' : 'Cancel this booking?',
      message: b.cancel_needs_review ? `Your request for <strong>${esc(b.booking_reference)}</strong> will be reviewed by the hotel. Your rooms stay reserved until it is approved.` : `Booking <strong>${esc(b.booking_reference)}</strong> will be cancelled immediately and the rooms released.`,
      confirmText: b.cancel_needs_review ? 'Send request' : 'Cancel booking',
      danger: true,
      input: { label: 'Reason for cancelling', required: true, min: 3, multiline: true, placeholder: 'e.g. Change of travel plans' },
    });
    if (!reason) return;
    try {
      const r = await api.post(`/bookings/${b.id}/cancel`, { reason });
      toast(r.result === 'CANCELLED' ? 'Your booking has been cancelled.' : 'Cancellation request sent. We will notify you once it is reviewed.', 'success');
      load();
    } catch (err) { toast(err.message, 'error'); }
  });
  if (location.hash === '#review' && b.can_review) $('#review-btn').click();
}

async function load() {
  await loadInto(app, async () => {
    try {
      const { booking } = await api.get(`/bookings/${id}`);
      render(booking);
    } catch (err) {
      if (err.status === 404) { app.innerHTML = emptyState({ icon: 'calendar', title: 'Booking not found', action: '<a class="btn" href="/customer/my-bookings.html">My bookings</a>' }); return; }
      throw err;
    }
  });
}

if (!id) app.innerHTML = emptyState({ icon: 'calendar', title: 'No booking selected', action: '<a class="btn" href="/customer/my-bookings.html">My bookings</a>' });
else load();
