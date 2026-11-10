import { api } from '../../api.js';
import { $, esc, icon, money, date, badge, debounce, initials } from '../../ui.js';
import { initDashboard } from '/components/dashboard-shell.js';
import { dataTable } from '/components/data-table.js';

const app = $('#app');
await initDashboard({ area: 'ADMIN', active: 'customers', title: 'Customers' });

app.innerHTML = `<div class="page-head"><div><h1>Customers</h1><p>Registered guest accounts, their bookings and spend.</p></div><div class="actions"><a class="btn btn-outline" href="/admin/reports.html?report=customers">${icon('chart')} Customer report</a></div></div>
  <div class="card"><form class="toolbar" id="f" novalidate>
    <div class="field grow"><label for="q">Search</label><input id="q" class="input" name="q" placeholder="Name, email or phone"></div>
    <div class="field"><label for="s">Status</label><select id="s" class="select" name="status"><option value="">All</option><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select></div>
  </form><div id="t"></div></div>`;

const table = dataTable($('#t'), {
  sortable: false,
  empty: { icon: 'users', title: 'No customers found' },
  fetch: (s) => api.get('/admin/customers', { q: $('#q').value.trim(), status: $('#s').value, page: s.page, page_size: 20 }),
  onRowClick: (u) => { location.href = `/admin/customer-details.html?id=${u.id}`; },
  columns: [
    { key: 'name', label: 'Customer', render: (u) => `<div class="row" style="flex-wrap:nowrap"><span class="avatar">${esc(initials(u.first_name, u.last_name))}</span><div><div class="cell-main">${esc(u.first_name)} ${esc(u.last_name)}</div><div class="cell-sub">${esc(u.email)}</div></div></div>` },
    { key: 'phone', label: 'Phone', render: (u) => esc(u.phone || '—') },
    { key: 'verified', label: 'Email', render: (u) => (u.email_verified ? '<span class="badge badge-success">Verified</span>' : '<span class="badge badge-warning">Unverified</span>') },
    { key: 'booking_count', label: 'Bookings', cls: 'num' },
    { key: 'total_spent', label: 'Net spent', cls: 'num', render: (u) => money(u.total_spent) },
    { key: 'created_at', label: 'Joined', cls: 'nowrap', render: (u) => date(u.created_at.slice(0, 10), { month: 'short', day: 'numeric', year: 'numeric' }) },
    { key: 'status', label: 'Status', render: (u) => badge(u.account_status) },
  ],
});
$('#f').addEventListener('input', debounce(() => table.reset(), 300));
$('#f').addEventListener('submit', (e) => { e.preventDefault(); table.reset(); });
table.reset();
