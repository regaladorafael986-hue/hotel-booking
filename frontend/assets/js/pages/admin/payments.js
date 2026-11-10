import { api } from '../../api.js';
import { $, esc, icon, money, dateTime, badge, debounce, withLoading, toastError } from '../../ui.js';
import { initDashboard } from '/components/dashboard-shell.js';
import { dataTable } from '/components/data-table.js';

const app = $('#app');
await initDashboard({ area: 'ADMIN', active: 'payments', title: 'Payments & refunds' });
let tab = 'payments';

app.innerHTML = `<div class="page-head"><div><h1>Payments &amp; refunds</h1><p>Online and front-desk payments. Refunds are issued from a reservation's payment list.</p></div><div class="actions"><button class="btn btn-outline" id="export">${icon('download')} Export to Excel</button></div></div>
  <div class="stats" id="totals"></div>
  <div class="card">
    <div class="tabs" role="tablist"><button class="tab active" data-tab="payments" role="tab">Payments</button><button class="tab" data-tab="refunds" role="tab">Refunds</button></div>
    <form class="toolbar" id="f" novalidate>
      <div class="field grow"><label for="q">Search</label><input id="q" class="input" name="q" placeholder="Payment or booking reference, guest"></div>
      <div class="field"><label for="st">Status</label><select id="st" class="select" name="status"></select></div>
      <div class="field" data-only="payments"><label for="from">From</label><input id="from" class="input" type="date" name="from"></div>
      <div class="field" data-only="payments"><label for="to">To</label><input id="to" class="input" type="date" name="to"></div>
    </form>
    <div id="t"></div>
  </div>`;

const STATUS = {
  payments: [['', 'All'], ['PAID', 'Paid'], ['PENDING', 'Pending'], ['FAILED', 'Failed'], ['PARTIALLY_REFUNDED', 'Partially refunded'], ['REFUNDED', 'Refunded']],
  refunds: [['', 'All'], ['PENDING', 'Pending'], ['SUCCEEDED', 'Succeeded'], ['FAILED', 'Failed']],
};
const setStatusOptions = () => { $('#st').innerHTML = STATUS[tab].map(([v, l]) => `<option value="${v}">${l}</option>`).join(''); };
setStatusOptions();
const f = () => ({ q: $('#q').value.trim(), status: $('#st').value, from: $('#from').value, to: $('#to').value });

const paymentCols = [
  { key: 'ref', label: 'Payment', render: (p) => `<div class="cell-main">${esc(p.payment_reference)}</div><div class="cell-sub">${esc(p.provider === 'FRONT_DESK' ? 'Front desk' : p.provider)}${p.payment_method ? ` · ${esc(p.payment_method)}` : ''}</div>` },
  { key: 'booking', label: 'Booking', render: (p) => `<a href="/admin/booking-details.html?id=${p.booking.id}">${esc(p.booking.booking_reference)}</a><div class="cell-sub">${esc(p.booking.guest_first_name)} ${esc(p.booking.guest_last_name)}</div>` },
  { key: 'date', label: 'Date', cls: 'nowrap', render: (p) => dateTime(p.paid_at || p.created_at) },
  { key: 'by', label: 'Recorded by', render: (p) => (p.recorded_by ? `${esc(p.recorded_by.first_name)} ${esc(p.recorded_by.last_name)}` : '<span class="muted">Webhook</span>') },
  { key: 'status', label: 'Status', render: (p) => `${badge(p.payment_status)}${p.failure_reason ? `<div class="cell-sub">${esc(p.failure_reason)}</div>` : ''}` },
  { key: 'amount', label: 'Amount', cls: 'num', render: (p) => `${money(p.amount)}${p.amount_refunded ? `<div class="cell-sub">− ${money(p.amount_refunded)}</div>` : ''}` },
];
const refundCols = [
  { key: 'pay', label: 'Payment', render: (r) => `<div class="cell-main">${esc(r.payment.payment_reference)}</div><div class="cell-sub">${esc(r.payment.provider)}${r.provider_reference ? ` · ${esc(r.provider_reference)}` : ''}</div>` },
  { key: 'booking', label: 'Booking', render: (r) => `<a href="/admin/booking-details.html?id=${r.payment.booking.id}">${esc(r.payment.booking.booking_reference)}</a><div class="cell-sub">${esc(r.payment.booking.guest_first_name)} ${esc(r.payment.booking.guest_last_name)}</div>` },
  { key: 'reason', label: 'Reason', render: (r) => `<span class="small">${esc(r.reason || '')}</span>` },
  { key: 'date', label: 'Date', cls: 'nowrap', render: (r) => dateTime(r.created_at) },
  { key: 'status', label: 'Status', render: (r) => badge(r.refund_status) },
  { key: 'amount', label: 'Amount', cls: 'num', render: (r) => money(r.amount) },
];

let table;
function build() {
  app.querySelectorAll('[data-only]').forEach((el) => el.classList.toggle('hidden', el.dataset.only !== tab));
  table = dataTable($('#t'), {
    sortable: false,
    empty: { icon: 'card', title: tab === 'payments' ? 'No payments found' : 'No refunds found' },
    fetch: async (s) => {
      const r = tab === 'payments' ? await api.get('/admin/payments', { ...f(), page: s.page, page_size: 20 }) : await api.get('/admin/refunds', { status: f().status, page: s.page, page_size: 20 });
      if (!r.totals) $('#totals').innerHTML = '';
      else $('#totals').innerHTML = `<div class="stat accent"><div class="lbl">Collected ${icon('card')}</div><div class="val">${money(r.totals.collected)}</div><div class="sub">matching filters</div></div><div class="stat"><div class="lbl">Refunded ${icon('refresh')}</div><div class="val">${money(r.totals.refunded)}</div></div><div class="stat"><div class="lbl">Net ${icon('chart')}</div><div class="val">${money(r.totals.net)}</div></div>`;
      return r;
    },
    columns: tab === 'payments' ? paymentCols : refundCols,
  });
  table.reset();
}

app.addEventListener('click', (e) => {
  const t = e.target.closest('[data-tab]');
  if (t) { tab = t.dataset.tab; app.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('active', b === t)); setStatusOptions(); build(); }
});
$('#f').addEventListener('input', debounce(() => table.reset(), 300));
$('#f').addEventListener('submit', (e) => { e.preventDefault(); table.reset(); });
$('#export').addEventListener('click', (e) => withLoading(e.currentTarget, () => api.download('/admin/reports/payments', { format: 'xlsx', from: f().from, to: f().to, q: f().q }, 'payments.xlsx').catch(toastError)));
build();
