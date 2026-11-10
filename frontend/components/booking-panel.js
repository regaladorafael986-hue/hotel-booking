// Reservation detail + operations panel shared by the admin and front-desk areas.
import { api } from '/assets/js/api.js';
import { $, esc, icon, money, date, dateTime, plural, badge, loadInto, modal, confirmDialog, toast, toastError, withLoading, validateForm, formValues, showErrors, emptyState, today } from '/assets/js/ui.js';
import { can } from '/assets/js/session.js';

const METHODS = [['CASH', 'Cash'], ['CARD', 'Card (terminal)'], ['GCASH', 'GCash'], ['MAYA', 'Maya'], ['BANK_TRANSFER', 'Bank transfer']];

export function renderBookingPanel(container, bookingId, user, { backHref, backLabel } = {}) {
  const isAdmin = user.role === 'ADMIN';
  let b;
  let flashMsg = sessionStorage.getItem('se.flash');
  sessionStorage.removeItem('se.flash');

  async function refresh() {
    await loadInto(container, async () => {
      try {
        ({ booking: b } = await api.get(`/staff/bookings/${bookingId}`));
      } catch (err) {
        if (err.status === 404) { container.innerHTML = emptyState({ icon: 'calendar', title: 'Reservation not found', action: backHref ? `<a class="btn" href="${backHref}">${esc(backLabel)}</a>` : '' }); return; }
        throw err;
      }
      draw();
    });
  }

  function actionButtons() {
    const t = today();
    const out = [];
    const active = !['CANCELLED', 'EXPIRED', 'CHECKED_OUT'].includes(b.booking_status);
    if (b.booking_status === 'PENDING_CONFIRMATION') out.push(`<button class="btn btn-success btn-lg" data-act="confirm">${icon('check')} Confirm reservation</button>`);
    if (b.booking_status === 'CONFIRMED' && can(user, 'check_in')) {
      const early = b.check_in > t;
      out.push(`<button class="btn btn-lg" data-act="checkin" ${early ? 'disabled title="Available on the arrival date"' : ''}>${icon('door')} Check in</button>${early ? `<p class="small muted mb-0">Check-in opens on ${date(b.check_in)}.</p>` : ''}`);
    }
    if (b.booking_status === 'CHECKED_IN' && can(user, 'check_out')) out.push(`<button class="btn btn-lg" data-act="checkout">${icon('logout')} Check out</button>`);
    if (b.balance_due > 0 && ['PENDING_CONFIRMATION', 'CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT'].includes(b.booking_status) && can(user, 'collect_payment')) out.push(`<button class="btn btn-gold" data-act="pay">${icon('card')} Record payment (${money(b.balance_due)} due)</button>`);
    if (isAdmin && b.cancellation_status === 'REQUESTED') out.push(`<button class="btn btn-outline" data-act="review-cancel">${icon('alert')} Review cancellation request</button>`);
    if (isAdmin && ['PENDING_PAYMENT', 'PENDING_CONFIRMATION', 'CONFIRMED'].includes(b.booking_status) && b.cancellation_status !== 'REQUESTED') out.push(`<button class="btn btn-outline" data-act="cancel" style="color:var(--danger)">Cancel reservation</button>`);
    out.push(`<a class="btn btn-outline" href="${api.url(`/bookings/${b.id}/receipt`)}" target="_blank" rel="noopener" ${['PENDING_PAYMENT', 'EXPIRED'].includes(b.booking_status) ? 'hidden' : ''}>${icon('printer')} ${b.payment_status === 'PAID' ? 'Print receipt' : 'Print confirmation'}</a>`);
    if (!active && !out.length) out.push('<p class="muted small mb-0">No actions available.</p>');
    return out.join('');
  }

  function draw() {
    const roomsEditable = ['PENDING_PAYMENT', 'PENDING_CONFIRMATION', 'CONFIRMED', 'CHECKED_IN'].includes(b.booking_status) && can(user, 'assign_room');
    const timeline = [['Booked', b.created_at, b.source === 'WALK_IN' && b.created_by ? `walk-in by ${b.created_by.first_name}` : 'online'], ['Confirmed', b.confirmed_at], ['Checked in', b.checked_in_at], ['Checked out', b.checked_out_at], ['Cancellation requested', b.cancellation_requested_at, b.cancellation_reason], ['Cancelled', b.cancelled_at]]
      .filter(([, t]) => t).sort((x, y) => new Date(x[1]) - new Date(y[1]));
    container.innerHTML = `
      <div class="page-head">
        <div>${backHref ? `<a class="small" href="${backHref}">${icon('chevronLeft')} ${esc(backLabel)}</a>` : ''}<h1>${esc(b.booking_reference)}</h1>
          <div class="row mt-1">${badge(b.booking_status)} ${badge(b.payment_status)} ${badge(b.source)} ${b.cancellation_status === 'REQUESTED' ? badge('REQUESTED') : ''}</div></div>
      </div>
      ${flashMsg ? `<div class="alert alert-warning mb-3">${icon('alert')}<div>${esc(flashMsg)}</div></div>` : ''}
      ${b.cancellation_status === 'REQUESTED' ? `<div class="alert alert-warning mb-3">${icon('alert')}<div><strong>Cancellation requested</strong> ${dateTime(b.cancellation_requested_at)} — “${esc(b.cancellation_reason)}”. ${b.within_free_cancellation ? 'Within the free-cancellation window.' : 'Outside the free-cancellation window.'} Paid: ${money(b.amount_paid)}.</div></div>` : ''}
      ${b.special_requests ? `<div class="alert alert-info mb-3">${icon('msg')}<div><strong>Guest request:</strong> ${esc(b.special_requests)}</div></div>` : ''}
      <div class="detail-grid">
        <div class="stack" style="--stack:20px">
          <section class="card"><div class="card-head"><h2>Guest</h2>${b.user ? `${isAdmin ? `<a class="small" href="/admin/customer-details.html?id=${b.user.id}">View customer profile</a>` : '<span class="badge badge-muted plain">Registered guest</span>'}` : '<span class="badge badge-muted plain">No account</span>'}</div><div class="card-body">
            <dl class="kv">
              <dt>Name</dt><dd>${esc(b.guest_first_name)} ${esc(b.guest_last_name)}</dd>
              <dt>Email</dt><dd><a href="mailto:${esc(b.guest_email)}">${esc(b.guest_email)}</a></dd>
              <dt>Phone</dt><dd>${b.guest_phone ? `<a href="tel:${esc(b.guest_phone.replace(/\s/g, ''))}">${esc(b.guest_phone)}</a>` : '—'}</dd>
              <dt>Guests</dt><dd>${plural(b.adults, 'adult')}${b.children ? `, ${plural(b.children, 'child', 'children')}` : ''}</dd>
              <dt>Stay</dt><dd>${date(b.check_in)} → ${date(b.check_out)} · ${plural(b.nights, 'night')}</dd>
            </dl>
          </div></section>
          <section class="card"><div class="card-head"><h2>Rooms</h2><span class="small muted">Physical room assignment</span></div>
            <div class="table-wrap"><table class="table"><thead><tr><th>Category</th><th>Room</th><th>Housekeeping</th><th>Guests</th><th class="num">Rate / night</th><th></th></tr></thead><tbody>
            ${b.rooms.map((r) => `<tr><td class="cell-main">${esc(r.room_type.name)}</td><td><strong>${esc(r.room.room_number)}</strong> <span class="muted small">floor ${r.room.floor}</span></td><td>${badge(r.room.housekeeping_status)}</td><td>${r.adults}A${r.children ? ` ${r.children}C` : ''}</td><td class="num">${money(r.nightly_rate)}</td><td class="num">${roomsEditable ? `<button class="btn btn-outline btn-sm" data-assign="${r.id}">Change room</button>` : ''}</td></tr>`).join('')}
            </tbody></table></div>
          </section>
          <section class="card"><div class="card-head"><h2>Payments</h2><span class="small muted">${b.payment_method === 'ONLINE' ? 'Online booking' : 'Pay at hotel'}</span></div>
            ${b.payments.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Reference</th><th>Date</th><th>Channel</th><th>Status</th><th class="num">Amount</th>${isAdmin ? '<th></th>' : ''}</tr></thead><tbody>
              ${b.payments.map((p) => `<tr><td class="cell-main">${esc(p.payment_reference)}${p.notes ? `<div class="cell-sub">${esc(p.notes)}</div>` : ''}</td><td>${dateTime(p.paid_at || p.created_at)}</td><td>${esc(p.provider === 'FRONT_DESK' ? 'Front desk' : p.provider)}${p.payment_method ? ` · ${esc(p.payment_method)}` : ''}${p.recorded_by ? `<div class="cell-sub">by ${esc(p.recorded_by.first_name)} ${esc(p.recorded_by.last_name)}</div>` : ''}</td><td>${badge(p.payment_status)}</td><td class="num">${money(p.amount)}${p.amount_refunded ? `<div class="cell-sub">− ${money(p.amount_refunded)} refunded</div>` : ''}</td>
                ${isAdmin ? `<td class="num">${['PAID', 'PARTIALLY_REFUNDED'].includes(p.payment_status) ? `<button class="btn btn-outline btn-sm" data-refund="${p.id}">Refund</button>` : ''}</td>` : ''}</tr>
                ${p.refunds.map((r) => `<tr><td colspan="3" class="small muted">↳ Refund ${dateTime(r.created_at)} — ${esc(r.reason || '')}</td><td>${badge(r.refund_status)}</td><td class="num">− ${money(r.amount)}</td>${isAdmin ? '<td></td>' : ''}</tr>`).join('')}`).join('')}
            </tbody></table></div>` : '<div class="card-body muted">No payments recorded yet.</div>'}
          </section>
        </div>
        <aside class="stack" style="--stack:20px">
          <section class="card"><div class="card-head"><h2>Actions</h2></div><div class="card-body action-stack">${actionButtons()}</div></section>
          <section class="card"><div class="card-head"><h2>Charges</h2></div><div class="card-body price-lines">
            <div><span>Subtotal</span><span>${money(b.subtotal)}</span></div>
            ${b.discount ? `<div class="discount"><span>Discount ${esc(b.coupon_code || '')}</span><span>− ${money(b.discount)}</span></div>` : ''}
            <div><span>Taxes</span><span>${money(b.taxes)}</span></div>
            <div class="total"><span>Total</span><span>${money(b.total_amount)}</span></div>
            <div><span>Paid</span><span>${money(b.amount_paid)}</span></div>
            ${b.amount_refunded ? `<div><span>Refunded</span><span>− ${money(b.amount_refunded)}</span></div>` : ''}
            <div><strong>Balance due</strong><strong style="color:${b.balance_due > 0 ? 'var(--danger)' : 'var(--success)'}">${money(b.balance_due)}</strong></div>
          </div></section>
          <section class="card"><div class="card-head"><h2>Timeline</h2></div><div class="card-body"><ul class="timeline">${timeline.map(([l, t, note]) => `<li><strong>${l}</strong>${note ? ` <span class="small muted">· ${esc(note)}</span>` : ''}<time>${dateTime(t)}</time></li>`).join('')}</ul></div></section>
        </aside>
      </div>`;
  }

  // ───── Actions ─────
  container.addEventListener('click', () => { flashMsg = null; }, { capture: true, once: true });

  async function act(btn, fn, okMsg) {
    await withLoading(btn, async () => {
      try { const r = await fn(); toast(r?.message || okMsg, 'success'); await refresh(); } catch (err) { toastError(err); }
    });
  }

  function paymentModal(after) {
    const { el } = modal({
      title: `Record payment — ${b.booking_reference}`,
      body: `<form id="pay-form" class="stack" novalidate>
        <div class="alert alert-info">${icon('info')}<div>Balance due: <strong>${money(b.balance_due)}</strong></div></div>
        <div class="form-grid">
          <div class="field"><label for="pm-amt">Amount received (₱)</label><input id="pm-amt" class="input" type="number" name="amount" min="0.01" max="${b.balance_due}" step="0.01" required value="${b.balance_due}"><div class="field-error"></div></div>
          <div class="field"><label for="pm-m">Method</label><select id="pm-m" class="select" name="payment_method" required>${METHODS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select><div class="field-error"></div></div>
          <div class="field span-2"><label for="pm-n">Notes <span class="muted">(optional)</span></label><input id="pm-n" class="input" name="notes" maxlength="255" placeholder="e.g. OR #, terminal approval code"><div class="field-error"></div></div>
        </div></form>`,
      actions: [{ label: 'Cancel' }, {
        label: 'Record payment', cls: 'btn-gold',
        onClick: async (close, m, btn) => {
          const form = m.querySelector('#pay-form');
          if (!validateForm(form)) return;
          const v = formValues(form);
          await withLoading(btn, async () => {
            try {
              const r = await api.post('/staff/payments', { booking_id: b.id, amount: Number(v.amount), payment_method: v.payment_method, notes: v.notes });
              close();
              toast(r.message, 'success');
              await refresh();
              after?.();
            } catch (err) { showErrors(form, err); }
          });
        },
      }],
    });
    return el;
  }

  async function assignModal(bookingRoomId) {
    const line = b.rooms.find((r) => r.id === bookingRoomId);
    const { el, close } = modal({ title: `Assign room — ${line.room_type.name}`, body: '<div class="state"><div class="spinner"></div></div>', wide: true });
    try {
      const { items } = await api.get(`/staff/bookings/${b.id}/assignable-rooms`, { booking_room_id: bookingRoomId });
      const body = el.querySelector('.modal-body');
      body.innerHTML = `<p class="muted">Rooms free for ${date(b.check_in)} → ${date(b.check_out)}. Choosing a different category keeps the booked rate.</p>
        <div class="room-board">${items.map((r) => `<button type="button" class="room-tile hk-${r.housekeepingStatus}" data-room="${r.id}" ${r.current ? 'disabled style="outline:2px solid var(--gold)"' : ''}><span class="no">${esc(r.roomNumber)}</span><span class="type">${esc(r.room_type_name)}${r.same_type ? '' : ' (upgrade/change)'}</span>${badge(r.housekeepingStatus)}${r.current ? '<span class="small">Current</span>' : ''}</button>`).join('') || '<p>No other rooms are free for these dates.</p>'}</div>`;
      body.addEventListener('click', async (e) => {
        const t = e.target.closest('[data-room]');
        if (!t || t.disabled) return;
        t.classList.add('is-loading');
        try {
          await api.post(`/staff/bookings/${b.id}/assign-room`, { booking_room_id: bookingRoomId, room_id: Number(t.dataset.room) });
          close();
          toast('Room assigned.', 'success');
          refresh();
        } catch (err) { toastError(err); t.classList.remove('is-loading'); }
      });
    } catch (err) { close(); toastError(err); }
  }

  container.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act], [data-assign], [data-refund]');
    if (!btn) return;
    if (btn.dataset.assign) return assignModal(Number(btn.dataset.assign));
    if (btn.dataset.refund) return refundModal(Number(btn.dataset.refund));
    switch (btn.dataset.act) {
      case 'confirm':
        return act(btn, () => api.post(`/staff/bookings/${b.id}/confirm`), 'Reservation confirmed.');
      case 'checkin':
        return withLoading(btn, async () => {
          try {
            const r = await api.post(`/staff/bookings/${b.id}/check-in`, {});
            toast(r.message, 'success');
            refresh();
          } catch (err) {
            if (err.code === 'ROOM_NOT_READY' && await confirmDialog({ title: 'Room not marked clean', message: `${esc(err.message)}<br><br>Check the guest in anyway?`, confirmText: 'Check in anyway' })) {
              try { const r = await api.post(`/staff/bookings/${b.id}/check-in`, { override_housekeeping: true }); toast(r.message, 'success'); refresh(); } catch (e2) { toastError(e2); }
            } else if (err.code !== 'ROOM_NOT_READY') toastError(err);
          }
        });
      case 'checkout':
        return withLoading(btn, async () => {
          try {
            const r = await api.post(`/staff/bookings/${b.id}/check-out`, {});
            toast(r.message, 'success');
            refresh();
          } catch (err) {
            if (err.code === 'BALANCE_DUE' && can(user, 'collect_payment')) { toast(err.message, 'error'); paymentModal(); } else toastError(err);
          }
        });
      case 'pay':
        return paymentModal();
      case 'cancel': {
        const reason = await confirmDialog({ title: 'Cancel reservation', message: `Cancel <strong>${esc(b.booking_reference)}</strong>? The guest will be notified and rooms released.${b.amount_paid ? ` <br><br>${money(b.amount_paid)} has been paid — issue refunds from the payments table after cancelling.` : ''}`, confirmText: 'Cancel reservation', danger: true, input: { label: 'Reason (sent to the guest)', required: true, min: 3, multiline: true } });
        if (reason) act(btn, () => api.put(`/admin/bookings/${b.id}/status`, { status: 'CANCELLED', reason }), 'Reservation cancelled.');
        return;
      }
      case 'review-cancel':
        return cancellationModal();
      default:
    }
  });

  function cancellationModal() {
    const refundable = b.amount_paid - b.amount_refunded;
    modal({
      title: `Cancellation request — ${b.booking_reference}`,
      body: `<form id="cr-form" class="stack" novalidate>
        <dl class="kv"><dt>Reason</dt><dd>${esc(b.cancellation_reason)}</dd><dt>Requested</dt><dd>${dateTime(b.cancellation_requested_at)}</dd><dt>Policy</dt><dd>${b.within_free_cancellation ? 'Within free-cancellation window' : 'Outside free-cancellation window'}</dd><dt>Refundable</dt><dd>${money(refundable)}</dd></dl>
        <div class="field"><label for="cr-ref">Refund amount if approved (₱)</label><input id="cr-ref" class="input" type="number" name="refund_amount" min="0" max="${refundable}" step="0.01" value="${b.suggested_refund}"><div class="hint">Suggested by policy: ${money(b.suggested_refund)}. Online payments are refunded through the payment provider.</div><div class="field-error"></div></div>
        <div class="field"><label for="cr-note">Note to guest <span class="muted">(optional)</span></label><textarea id="cr-note" class="textarea" name="note" maxlength="1000"></textarea></div>
      </form>`,
      actions: [
        { label: 'Close' },
        { label: 'Decline request', cls: 'btn-outline', onClick: (close, m, btn) => decide(false, close, m, btn) },
        { label: 'Approve & cancel', cls: 'btn-danger', onClick: (close, m, btn) => decide(true, close, m, btn) },
      ],
    });
    async function decide(approve, close, m, btn) {
      const form = m.querySelector('#cr-form');
      if (approve && !validateForm(form)) return;
      const v = formValues(form);
      await withLoading(btn, async () => {
        try {
          const r = await api.post(`/admin/bookings/${b.id}/cancellation-review`, { approve, note: v.note, refund_amount: approve && v.refund_amount ? Number(v.refund_amount) : undefined });
          close();
          toast(r.message, 'success');
          refresh();
        } catch (err) { showErrors(form, err); }
      });
    }
  }

  function refundModal(paymentId) {
    const p = b.payments.find((x) => x.id === paymentId);
    const pending = p.refunds.filter((r) => r.refund_status !== 'FAILED').reduce((s, r) => s + r.amount, 0);
    const max = Math.round((p.amount - pending) * 100) / 100;
    modal({
      title: `Refund ${p.payment_reference}`,
      body: `<form id="rf-form" class="stack" novalidate>
        <p class="muted mb-0">Paid ${money(p.amount)} via ${esc(p.payment_method || p.provider)}. Refundable: <strong>${money(max)}</strong>. ${p.provider === 'FRONT_DESK' ? 'Front-desk payments are refunded in person; this records the refund.' : 'The refund is submitted to the payment provider.'}</p>
        <div class="field"><label for="rf-amt">Amount (₱)</label><input id="rf-amt" class="input" type="number" name="amount" min="0.01" max="${max}" step="0.01" required value="${max}"><div class="field-error"></div></div>
        <div class="field"><label for="rf-r">Reason</label><input id="rf-r" class="input" name="reason" required minlength="3" maxlength="255" placeholder="e.g. Goodwill gesture, overcharge"><div class="field-error"></div></div>
      </form>`,
      actions: [{ label: 'Cancel' }, {
        label: 'Issue refund', cls: 'btn-danger',
        onClick: async (close, m, btn) => {
          const form = m.querySelector('#rf-form');
          if (!validateForm(form)) return;
          const v = formValues(form);
          await withLoading(btn, async () => {
            try { const r = await api.post(`/payments/${p.id}/refund`, { amount: Number(v.amount), reason: v.reason }); close(); toast(r.message, 'success'); refresh(); } catch (err) { showErrors(form, err); }
          });
        },
      }],
    });
  }

  refresh();
  return { refresh };
}
