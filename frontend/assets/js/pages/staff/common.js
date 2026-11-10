// Front-desk list cards with large check-in / check-out actions.
import { api } from '../../api.js';
import { esc, icon, money, date, plural, badge, confirmDialog, toast, toastError, withLoading, today } from '../../ui.js';
import { can } from '../../session.js';

export const bookingHref = (user, id) => (user.role === 'ADMIN' ? `/admin/booking-details.html?id=${id}` : `/staff/booking.html?id=${id}`);

export function deskCard(b, user, mode) {
  const rooms = b.rooms.map((r) => r.room.room_number).join(', ');
  let action = '';
  if (mode === 'arrival') {
    if (b.booking_status === 'CONFIRMED' && can(user, 'check_in') && b.check_in <= today()) action = `<button class="btn btn-lg" data-checkin="${b.id}">${icon('door')} Check in</button>`;
    else if (b.booking_status === 'PENDING_CONFIRMATION') action = `<a class="btn btn-outline btn-lg" href="${bookingHref(user, b.id)}">Confirm first</a>`;
    else if (b.booking_status === 'CHECKED_IN') action = `<span class="badge badge-success">Checked in</span>`;
  } else if (mode === 'departure') {
    if (b.booking_status === 'CHECKED_IN' && can(user, 'check_out')) action = `<button class="btn btn-lg ${b.balance_due > 0 ? 'btn-gold' : ''}" data-checkout="${b.id}">${icon('logout')} ${b.balance_due > 0 ? `Collect ${money(b.balance_due)}` : 'Check out'}</button>`;
    else if (b.booking_status === 'CHECKED_OUT') action = `<span class="badge badge-muted">Checked out</span>`;
  } else {
    action = `<a class="btn btn-outline" href="${bookingHref(user, b.id)}">Open</a>`;
  }
  return `<div class="desk-card">
    <div class="who"><a href="${bookingHref(user, b.id)}" style="text-decoration:none"><strong>${esc(b.guest_first_name)} ${esc(b.guest_last_name)}</strong></a> <span class="small muted">${esc(b.booking_reference)}</span>
      <div class="meta"><span>${icon('bed')} ${esc(b.room_summary.map((r) => `${r.name}${r.quantity > 1 ? ` ×${r.quantity}` : ''}`).join(', '))}</span><span>${icon('door')} Room ${esc(rooms)}</span><span>${icon('users')} ${plural(b.adults + b.children, 'guest')}</span><span>${icon('calendar')} ${date(b.check_in, { month: 'short', day: 'numeric' })} → ${date(b.check_out, { month: 'short', day: 'numeric' })}</span></div>
      <div class="row mt-1" style="gap:6px">${badge(b.booking_status)} ${b.balance_due > 0 && !['CANCELLED', 'EXPIRED'].includes(b.booking_status) ? `<span class="badge badge-danger">Due ${money(b.balance_due)}</span>` : badge(b.payment_status)}${b.special_requests ? `<span class="badge badge-info" title="${esc(b.special_requests)}">Request</span>` : ''}</div>
    </div>
    <div>${action}</div>
  </div>`;
}

/** Wire the list buttons. `onDone` refreshes the list after an action. */
export function bindDeskActions(root, user, onDone) {
  root.addEventListener('click', async (e) => {
    const ci = e.target.closest('[data-checkin]');
    const co = e.target.closest('[data-checkout]');
    if (ci) {
      await withLoading(ci, async () => {
        const id = ci.dataset.checkin;
        try {
          await api.post(`/staff/bookings/${id}/check-in`, {});
          toast('Guest checked in.', 'success');
          onDone();
        } catch (err) {
          if (err.code === 'ROOM_NOT_READY') {
            if (await confirmDialog({ title: 'Room not marked clean', message: `${esc(err.message)}<br><br>Check the guest in anyway?`, confirmText: 'Check in anyway' })) {
              try { await api.post(`/staff/bookings/${id}/check-in`, { override_housekeeping: true }); toast('Guest checked in.', 'success'); onDone(); } catch (e2) { toastError(e2); }
            }
          } else toastError(err);
        }
      });
    }
    if (co) {
      await withLoading(co, async () => {
        const id = co.dataset.checkout;
        try {
          await api.post(`/staff/bookings/${id}/check-out`, {});
          toast('Guest checked out. Room marked for cleaning.', 'success');
          onDone();
        } catch (err) {
          if (err.code === 'BALANCE_DUE') { toast(`${err.message} Opening the reservation…`, 'error'); setTimeout(() => { location.href = bookingHref(user, id); }, 900); } else toastError(err);
        }
      });
    }
  });
}
