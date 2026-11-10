import { api } from '../../api.js';
import { $, esc, icon, dateTime, ago, toast } from '../../ui.js';
import { initDashboard } from '/components/dashboard-shell.js';
import { dataTable } from '/components/data-table.js';

const app = $('#app');
await initDashboard({ area: 'CUSTOMER', active: 'notifications', title: 'Notifications' });

app.innerHTML = `<div class="page-head"><div><h1>Notifications</h1><p>Booking, payment and reminder updates.</p></div><div class="actions"><button class="btn btn-outline" id="all">Mark all as read</button></div></div>
  <div class="card"><div class="toolbar"><div class="seg" role="group" aria-label="Filter"><button class="active" data-f="">All</button><button data-f="true">Unread</button></div></div><div id="t"></div></div>`;

let unread = '';
const table = dataTable($('#t'), {
  sortable: false,
  pageSize: 15,
  empty: { icon: 'bell', title: 'No notifications', text: 'You are all caught up.' },
  fetch: (s) => api.get('/notifications', { page: s.page, page_size: 15, unread }),
  rowAttrs: (n) => (n.is_read ? '' : 'style="background:#fbf8f1"'),
  onRowClick: async (n) => {
    if (!n.is_read) await api.post(`/notifications/${n.id}/read`).catch(() => {});
    if (n.booking_id) location.href = `/customer/booking-details.html?id=${n.booking_id}`; else table.reload();
  },
  columns: [
    { key: 'title', label: 'Notification', render: (n) => `<div class="cell-main">${n.is_read ? '' : `<span class="badge badge-gold plain" style="margin-right:6px">New</span>`}${esc(n.title)}</div><div class="cell-sub">${esc(n.message)}</div>` },
    { key: 'type', label: 'Type', render: (n) => `<span class="badge badge-muted plain">${esc(n.type.toLowerCase())}</span>` },
    { key: 'created_at', label: 'When', cls: 'nowrap', render: (n) => `<span title="${dateTime(n.created_at)}">${ago(n.created_at)}</span>` },
    { key: 'go', label: '', cls: 'num', render: (n) => (n.booking_id ? icon('chevronRight') : '') },
  ],
});
table.reset();

app.addEventListener('click', async (e) => {
  const f = e.target.closest('[data-f]');
  if (f) { unread = f.dataset.f; app.querySelectorAll('[data-f]').forEach((b) => b.classList.toggle('active', b === f)); table.reset(); }
  if (e.target.closest('#all')) {
    try { await api.post('/notifications/read-all'); toast('All notifications marked as read.', 'success'); table.reload(); } catch (err) { toast(err.message, 'error'); }
  }
});
