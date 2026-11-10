// Reservation search for the front desk (also reused by the admin reservations page).
import { api } from '../../api.js';
import { $, esc, money, date, badge, debounce, params, icon, withLoading, toastError } from '../../ui.js';
import { initDashboard } from '/components/dashboard-shell.js';
import { dataTable } from '/components/data-table.js';
import { bookingHref } from './common.js';

const isAdminPage = location.pathname.startsWith('/admin');
const app = $('#app');
const user = await initDashboard(isAdminPage ? { area: 'ADMIN', active: 'bookings', title: 'Reservations' } : { area: 'RECEPTIONIST', active: 'bookings', title: 'Find reservation' });
const p = params();
const STATUS_OPTS = [['', 'All statuses'], ['PENDING_PAYMENT', 'Awaiting payment'], ['PENDING_CONFIRMATION', 'Awaiting confirmation'], ['CONFIRMED', 'Confirmed'], ['CHECKED_IN', 'Checked in'], ['CHECKED_OUT', 'Checked out'], ['CANCELLED', 'Cancelled'], ['EXPIRED', 'Expired']];
const PAY_OPTS = [['', 'Any payment'], ['PENDING', 'Pending'], ['PAID', 'Paid'], ['FAILED', 'Failed'], ['PARTIALLY_REFUNDED', 'Partially refunded'], ['REFUNDED', 'Refunded']];

app.innerHTML = `<div class="page-head"><div><h1>${isAdminPage ? 'Reservations' : 'Find a reservation'}</h1><p>Search by reference, guest name, email or phone.</p></div>
  <div class="actions">${isAdminPage ? `<button class="btn btn-outline" id="export">${icon('download')} Export</button>` : ''}<a class="btn btn-gold" href="/staff/walk-in.html">${icon('plus')} New walk-in</a></div></div>
  <div class="card">
    <form class="toolbar" id="filters" novalidate>
      <div class="field grow"><label for="q">Search</label><input id="q" class="input" name="q" placeholder="SE-…, name, email, phone" value="${esc(p.q || '')}"></div>
      <div class="field"><label for="st">Status</label><select id="st" class="select" name="status">${STATUS_OPTS.map(([v, l]) => `<option value="${v}" ${p.status === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="field"><label for="ps">Payment</label><select id="ps" class="select" name="payment_status">${PAY_OPTS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></div>
      <div class="field"><label for="df">Date</label><select id="df" class="select" name="date_field"><option value="check_in">Check-in</option><option value="check_out">Check-out</option><option value="created_at">Booked on</option></select></div>
      <div class="field"><label for="from">From</label><input id="from" type="date" class="input" name="from"></div>
      <div class="field"><label for="to">To</label><input id="to" type="date" class="input" name="to"></div>
      ${isAdminPage ? `<div class="field"><label class="check" style="min-height:40px;align-items:center"><input type="checkbox" name="cancel_req" ${p.cancellation === 'REQUESTED' ? 'checked' : ''}> <span class="small">Cancellation requests</span></label></div>` : ''}
      <button class="btn btn-ghost" type="reset">Clear</button>
    </form>
    <div id="table"></div>
  </div>`;

const form = $('#filters');
const filters = () => {
  const f = Object.fromEntries(new FormData(form));
  if (f.from && f.to && f.from > f.to) { $('#to').setCustomValidity('x'); } else $('#to').setCustomValidity('');
  return { q: f.q, status: f.status, payment_status: f.payment_status, date_field: f.date_field, from: f.from, to: f.to && (!f.from || f.to >= f.from) ? f.to : undefined, cancellation_status: f.cancel_req ? 'REQUESTED' : undefined };
};

const table = dataTable($('#table'), {
  defaultSort: 'created_at',
  empty: { icon: 'search', title: 'No reservations found', text: 'Try a different search or clear the filters.' },
  fetch: (s) => api.get(isAdminPage ? '/admin/bookings' : '/staff/bookings', { ...filters(), page: s.page, sort: s.sort, order: s.order, page_size: 15 }),
  onRowClick: (b) => { location.href = bookingHref(user, b.id); },
  columns: [
    { key: 'booking_reference', label: 'Reference', render: (b) => `<div class="cell-main">${esc(b.booking_reference)}</div><div class="cell-sub">${b.source === 'WALK_IN' ? 'Walk-in' : 'Online'} · ${b.payment_method === 'ONLINE' ? 'prepaid' : 'pay at hotel'}</div>` },
    { key: 'guest', label: 'Guest', render: (b) => `<div>${esc(b.guest_first_name)} ${esc(b.guest_last_name)}</div><div class="cell-sub">${esc(b.guest_email)}</div>` },
    { key: 'rooms', label: 'Rooms', render: (b) => `${esc(b.room_summary.map((r) => `${r.name}${r.quantity > 1 ? ` ×${r.quantity}` : ''}`).join(', '))}<div class="cell-sub">Room ${esc(b.rooms.map((r) => r.room.room_number).join(', '))}</div>` },
    { key: 'check_in', label: 'Check-in', sortable: true, cls: 'nowrap', render: (b) => `${date(b.check_in, { month: 'short', day: 'numeric', year: 'numeric' })}<div class="cell-sub">${b.nights} night${b.nights > 1 ? 's' : ''}</div>` },
    { key: 'status', label: 'Status', render: (b) => `${badge(b.booking_status)}${b.cancellation_status === 'REQUESTED' ? `<div class="mt-1">${badge('REQUESTED')}</div>` : ''}` },
    { key: 'payment', label: 'Payment', render: (b) => badge(b.payment_status) },
    { key: 'total_amount', label: 'Total', sortable: true, cls: 'num', render: (b) => `${money(b.total_amount)}${b.balance_due > 0 && !['CANCELLED', 'EXPIRED'].includes(b.booking_status) ? `<div class="cell-sub" style="color:var(--danger)">${money(b.balance_due)} due</div>` : ''}` },
    { key: 'created_at', label: 'Booked', sortable: true, cls: 'nowrap', render: (b) => `<span class="small">${date(b.created_at.slice(0, 10), { month: 'short', day: 'numeric' })}</span>` },
  ],
});

const reload = debounce(() => table.reset(), 300);
form.addEventListener('input', reload);
form.addEventListener('change', reload);
form.addEventListener('submit', (e) => { e.preventDefault(); table.reset(); });
form.addEventListener('reset', () => setTimeout(() => table.reset()));
$('#export')?.addEventListener('click', async (e) => {
  const { from, to, status } = filters();
  await withLoading(e.currentTarget, () => api.download('/admin/reports/bookings', { format: 'xlsx', from, to, status }, 'bookings.xlsx').catch(toastError));
});
table.reset();
