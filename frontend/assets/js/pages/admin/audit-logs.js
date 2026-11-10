import { api } from '../../api.js';
import { $, esc, dateTime, badge, debounce } from '../../ui.js';
import { initDashboard } from '/components/dashboard-shell.js';
import { dataTable } from '/components/data-table.js';

const app = $('#app');
await initDashboard({ area: 'ADMIN', active: 'audit', title: 'Activity log' });
let actionsLoaded = false;

app.innerHTML = `<div class="page-head"><div><h1>Activity log</h1><p>Administrative, front-desk, payment and security events.</p></div></div>
  <div class="card"><form class="toolbar" id="f" novalidate>
    <div class="field grow"><label for="q">Search</label><input id="q" class="input" name="q" placeholder="Description, action or user email"></div>
    <div class="field"><label for="ac">Action</label><select id="ac" class="select" name="action"><option value="">All actions</option></select></div>
    <div class="field"><label for="from">From</label><input id="from" type="date" class="input" name="from"></div>
    <div class="field"><label for="to">To</label><input id="to" type="date" class="input" name="to"></div>
  </form><div id="t"></div></div>`;

const table = dataTable($('#t'), {
  sortable: false,
  pageSize: 25,
  empty: { icon: 'log', title: 'No activity found' },
  fetch: async (s) => {
    const v = Object.fromEntries(new FormData($('#f')));
    const r = await api.get('/admin/audit-logs', { ...v, page: s.page, page_size: 25 });
    if (!actionsLoaded) { $('#ac').insertAdjacentHTML('beforeend', r.actions.map((a) => `<option>${esc(a)}</option>`).join('')); actionsLoaded = true; }
    return r;
  },
  columns: [
    { key: 'created_at', label: 'When', cls: 'nowrap', render: (l) => dateTime(l.created_at) },
    { key: 'action', label: 'Action', render: (l) => `<code class="small">${esc(l.action)}</code>` },
    { key: 'description', label: 'Details', render: (l) => `<span class="small">${esc(l.description || '')}</span>${l.entity_type ? `<div class="cell-sub">${esc(l.entity_type)} #${esc(l.entity_id || '')}</div>` : ''}` },
    { key: 'user', label: 'By', render: (l) => (l.user ? `${esc(l.user.first_name)} ${esc(l.user.last_name)} ${badge(l.user.role)}` : '<span class="muted small">System</span>') },
    { key: 'ip', label: 'IP', render: (l) => `<span class="small muted">${esc(l.ip_address || '')}</span>` },
  ],
});
$('#f').addEventListener('input', debounce(() => table.reset(), 300));
$('#f').addEventListener('change', () => table.reset());
$('#f').addEventListener('submit', (e) => { e.preventDefault(); table.reset(); });
table.reset();
