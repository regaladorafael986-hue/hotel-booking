import { api } from '../../api.js';
import { $, esc, icon, money, date, dateTime, badge, params, loadInto, emptyState, confirmDialog, toast, toastError, initials, stars } from '../../ui.js';
import { initDashboard } from '/components/dashboard-shell.js';

const app = $('#app');
await initDashboard({ area: 'ADMIN', active: 'customers', title: 'Customer' });
const id = params().id;

async function load() {
  await loadInto(app, async () => {
    let c;
    try { ({ customer: c } = await api.get(`/admin/customers/${id}`)); } catch (err) {
      if (err.status === 404) { app.innerHTML = emptyState({ icon: 'user', title: 'Customer not found', action: '<a class="btn" href="/admin/customers.html">All customers</a>' }); return; }
      throw err;
    }
    const paid = c.payments.filter((p) => p.payment_status !== 'PENDING' && p.payment_status !== 'FAILED').reduce((s, p) => s + p.amount - p.amount_refunded, 0);
    app.innerHTML = `
      <div class="page-head"><div><a class="small" href="/admin/customers.html">${icon('chevronLeft')} Customers</a>
        <div class="row mt-1"><span class="avatar" style="width:52px;height:52px;font-size:1.1rem">${esc(initials(c.first_name, c.last_name))}</span><div><h1 class="mb-0">${esc(c.first_name)} ${esc(c.last_name)}</h1><div class="row" style="gap:6px">${badge(c.account_status)} ${c.email_verified ? '<span class="badge badge-success">Email verified</span>' : '<span class="badge badge-warning">Unverified</span>'}</div></div></div></div>
        <div class="actions"><button class="btn ${c.account_status === 'ACTIVE' ? 'btn-outline' : 'btn-success'}" id="toggle" ${c.account_status === 'ACTIVE' ? 'style="color:var(--danger)"' : ''}>${c.account_status === 'ACTIVE' ? 'Deactivate account' : 'Activate account'}</button></div></div>
      <div class="stats">
        <div class="stat"><div class="lbl">Bookings ${icon('calendar')}</div><div class="val">${c.bookings.length}</div><div class="sub">${c.bookings.filter((b) => b.booking_status === 'CHECKED_OUT').length} completed stays</div></div>
        <div class="stat accent"><div class="lbl">Net spent ${icon('card')}</div><div class="val">${money(paid)}</div></div>
        <div class="stat"><div class="lbl">Reviews ${icon('star')}</div><div class="val">${c.reviews.length}</div></div>
        <div class="stat"><div class="lbl">Contact ${icon('mail')}</div><div class="small" style="color:var(--navy)"><a href="mailto:${esc(c.email)}">${esc(c.email)}</a><br>${esc(c.phone || 'No phone')}</div><div class="sub">Member since ${date(c.created_at.slice(0, 10))} · last login ${c.last_login_at ? dateTime(c.last_login_at) : 'never'}</div></div>
      </div>
      <section class="card mb-3"><div class="card-head"><h2>Booking history</h2></div>
        ${c.bookings.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Reference</th><th>Rooms</th><th>Stay</th><th>Status</th><th>Payment</th><th class="num">Total</th></tr></thead><tbody>
          ${c.bookings.map((b) => `<tr class="clickable" data-href="/admin/booking-details.html?id=${b.id}"><td class="cell-main">${esc(b.booking_reference)}</td><td>${esc([...new Set(b.rooms.map((r) => r.room_type.name))].join(', '))}</td><td class="nowrap">${date(b.check_in, { month: 'short', day: 'numeric', year: 'numeric' })} · ${b.nights}n</td><td>${badge(b.booking_status)}</td><td>${badge(b.payment_status)}</td><td class="num">${money(b.total_amount)}</td></tr>`).join('')}
        </tbody></table></div>` : emptyState({ icon: 'calendar', title: 'No bookings yet' })}</section>
      <div class="dash-grid">
        <section class="card span-7"><div class="card-head"><h2>Payment history</h2></div>
          ${c.payments.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Payment</th><th>Booking</th><th>Date</th><th>Status</th><th class="num">Amount</th></tr></thead><tbody>
            ${c.payments.map((p) => `<tr><td class="cell-main">${esc(p.payment_reference)}<div class="cell-sub">${esc(p.payment_method || p.provider)}</div></td><td>${esc(p.booking.booking_reference)}</td><td class="nowrap">${dateTime(p.paid_at || p.created_at)}</td><td>${badge(p.payment_status)}</td><td class="num">${money(p.amount)}</td></tr>`).join('')}
          </tbody></table></div>` : emptyState({ icon: 'card', title: 'No payments' })}</section>
        <section class="card span-5"><div class="card-head"><h2>Reviews</h2></div>
          ${c.reviews.length ? `<ul class="list-plain">${c.reviews.map((r) => `<li style="display:block">${stars(r.rating)} ${badge(r.status)}<p class="small mb-0 mt-1">${esc(r.comment || r.title || '')}</p></li>`).join('')}</ul>` : emptyState({ icon: 'star', title: 'No reviews' })}</section>
      </div>`;
    app.querySelectorAll('tr[data-href]').forEach((tr) => tr.addEventListener('click', () => { location.href = tr.dataset.href; }));
    $('#toggle').addEventListener('click', async () => {
      const next = c.account_status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
      if (!(await confirmDialog({ title: next === 'INACTIVE' ? 'Deactivate this account?' : 'Activate this account?', message: next === 'INACTIVE' ? 'The customer will be signed out and unable to log in. Existing reservations are not cancelled.' : 'The customer will be able to log in again.', confirmText: next === 'INACTIVE' ? 'Deactivate' : 'Activate', danger: next === 'INACTIVE' }))) return;
      try { const r = await api.put(`/admin/customers/${c.id}/status`, { account_status: next }); toast(r.message, 'success'); load(); } catch (err) { toastError(err); }
    });
  });
}
load();
