import { api } from '../../api.js';
import { $, esc, icon, date, badge, stars, confirmDialog, toast, toastError, debounce } from '../../ui.js';
import { initDashboard } from '/components/dashboard-shell.js';
import { dataTable } from '/components/data-table.js';

const app = $('#app');
await initDashboard({ area: 'ADMIN', active: 'reviews', title: 'Reviews' });
let status = 'PENDING';
let rows = [];

app.innerHTML = `<div class="page-head"><div><h1>Reviews</h1><p>Approve guest reviews before they appear on the website.</p></div></div>
  <div class="card"><div class="toolbar"><div class="seg" role="group" aria-label="Status"><button class="active" data-s="PENDING">Pending</button><button data-s="APPROVED">Published</button><button data-s="REJECTED">Rejected</button><button data-s="">All</button></div><div class="field grow"><label for="q" class="sr-only">Search</label><input id="q" class="input" placeholder="Search text, booking reference or guest"></div></div><div id="t"></div></div>`;

const table = dataTable($('#t'), {
  sortable: false,
  empty: { icon: 'star', title: 'No reviews here', text: status === 'PENDING' ? 'Nothing waiting for moderation.' : '' },
  fetch: async (s) => { const r = await api.get('/admin/reviews', { status, q: $('#q').value.trim(), page: s.page }); rows = r.items; return r; },
  columns: [
    { key: 'r', label: 'Review', render: (r) => `${stars(r.rating)}${r.title ? ` <strong>${esc(r.title)}</strong>` : ''}<div class="small" style="max-width:520px;white-space:normal">${esc(r.comment || '')}</div>` },
    { key: 'g', label: 'Guest', render: (r) => `<a href="/admin/customer-details.html?id=${r.user.id}">${esc(r.user.first_name)} ${esc(r.user.last_name)}</a><div class="cell-sub"><a href="/admin/booking-details.html?id=${r.booking.id}">${esc(r.booking.booking_reference)}</a> · stay ${date(r.booking.check_in, { month: 'short', year: 'numeric' })}</div>` },
    { key: 'd', label: 'Submitted', cls: 'nowrap', render: (r) => date(r.created_at.slice(0, 10), { month: 'short', day: 'numeric', year: 'numeric' }) },
    { key: 's', label: 'Status', render: (r) => badge(r.status, r.status === 'APPROVED' ? 'Published' : null) },
    { key: 'a', label: '', render: (r) => `<div class="actions">${r.status !== 'APPROVED' ? `<button class="btn btn-success btn-sm" data-mod="${r.id}" data-to="APPROVED">${icon('check')} Approve</button>` : ''}${r.status !== 'REJECTED' ? `<button class="btn btn-outline btn-sm" data-mod="${r.id}" data-to="REJECTED">Reject</button>` : ''}<button class="btn btn-ghost btn-sm" data-del="${r.id}" title="Delete">${icon('trash')}</button></div>` },
  ],
});

app.addEventListener('click', async (e) => {
  const s = e.target.closest('[data-s]');
  if (s) { status = s.dataset.s; app.querySelectorAll('[data-s]').forEach((b) => b.classList.toggle('active', b === s)); table.reset(); }
  const m = e.target.closest('[data-mod]');
  if (m) { try { await api.put(`/admin/reviews/${m.dataset.mod}`, { status: m.dataset.to }); toast(m.dataset.to === 'APPROVED' ? 'Review published.' : 'Review rejected.', 'success'); table.reload(); } catch (err) { toastError(err); } }
  const d = e.target.closest('[data-del]');
  if (d && await confirmDialog({ title: 'Delete review?', message: 'The guest will be able to submit a new review for this stay.', confirmText: 'Delete', danger: true })) {
    try { await api.del(`/admin/reviews/${d.dataset.del}`); toast('Review deleted.', 'success'); table.reload(); } catch (err) { toastError(err); }
  }
});
$('#q').addEventListener('input', debounce(() => table.reset(), 300));
table.reset();
