import { api } from '../../api.js';
import { $, esc, icon, money, num, date, dateTime, badge, params, today, addDaysStr, loadingState, errorState, emptyState, withLoading, toastError, debounce } from '../../ui.js';
import { initDashboard } from '/components/dashboard-shell.js';
import { renderChart } from '/components/charts.js';

const app = $('#app');
await initDashboard({ area: 'ADMIN', active: 'reports', title: 'Reports' });

const REPORTS = [
  ['revenue', 'Revenue', 'chart'], ['occupancy', 'Occupancy', 'bed'], ['bookings', 'Bookings', 'calendar'], ['payments', 'Payments', 'card'],
  ['cancellations', 'Cancellations', 'x'], ['customers', 'Customers', 'users'], ['checkins', 'Check-ins', 'arrowRight'], ['checkouts', 'Check-outs', 'logout'],
];
const PRESETS = [['7', 'Last 7 days'], ['30', 'Last 30 days'], ['90', 'Last 90 days'], ['month', 'This month'], ['year', 'This year'], ['365', 'Last 12 months']];
const p = params();
const state = { report: REPORTS.some(([k]) => k === p.report) ? p.report : 'revenue', group: 'day', from: addDaysStr(today(), -29), to: today(), q: '', sort: '', order: 'desc' };
let current;

app.innerHTML = `<div class="page-head no-print"><div><h1>Reports &amp; analytics</h1><p>All figures are calculated live from the database.</p></div>
    <div class="actions"><button class="btn btn-outline" id="print">${icon('printer')} Print</button><button class="btn btn-outline" data-export="pdf">${icon('file')} PDF</button><button class="btn" data-export="xlsx">${icon('download')} Excel</button></div></div>
  <div class="card mb-3 no-print"><div class="tabs" role="tablist">${REPORTS.map(([k, l]) => `<button class="tab ${k === state.report ? 'active' : ''}" data-report="${k}" role="tab">${l}</button>`).join('')}</div>
    <form class="toolbar" id="f" novalidate>
      <div class="field"><label for="preset">Period</label><select id="preset" class="select">${PRESETS.map(([v, l]) => `<option value="${v}" ${v === '30' ? 'selected' : ''}>${l}</option>`).join('')}<option value="custom">Custom…</option></select></div>
      <div class="field"><label for="from">From</label><input id="from" type="date" class="input" name="from" value="${state.from}" required></div>
      <div class="field"><label for="to">To</label><input id="to" type="date" class="input" name="to" value="${state.to}" required></div>
      <div class="field" id="group-field"><label for="group">Group by</label><select id="group" class="select" name="group"><option value="day">Day</option><option value="week">Week</option><option value="month">Month</option><option value="year">Year</option></select></div>
      <div class="field grow" id="q-field"><label for="q">Search</label><input id="q" class="input" name="q" placeholder="Filter rows…"></div>
      <div class="field-error" id="range-err" style="flex-basis:100%"></div>
    </form>
  </div>
  <div id="out"></div>`;

function preset(v) {
  const t = today();
  if (v === 'month') return [`${t.slice(0, 8)}01`, t];
  if (v === 'year') return [`${t.slice(0, 4)}-01-01`, t];
  return [addDaysStr(t, -(Number(v) - 1)), t];
}

function fmt(v, type) {
  if (v === null || v === undefined || v === '') return '—';
  switch (type) {
    case 'money': return money(v);
    case 'percent': return `${Number(v).toFixed(1)}%`;
    case 'number': return num(v);
    case 'date': return v.length === 10 ? date(v, { month: 'short', day: 'numeric', year: 'numeric' }) : esc(v);
    case 'datetime': return dateTime(v);
    case 'status': return badge(v);
    default: return esc(v);
  }
}

async function load() {
  const out = $('#out');
  $('#range-err').textContent = state.from > state.to ? '"From" must be before "To".' : '';
  if (state.from > state.to) return;
  $('#group-field').classList.toggle('hidden', state.report !== 'revenue');
  $('#q-field').classList.toggle('hidden', ['revenue', 'occupancy'].includes(state.report));
  out.innerHTML = loadingState('Building report…');
  try {
    current = await api.get(`/admin/reports/${state.report}`, { from: state.from, to: state.to, group: state.group, q: state.q, sort: state.sort, order: state.order });
    const r = current;
    out.innerHTML = `<section class="card mb-3"><div class="card-head"><div><h2 class="serif" style="font-size:1.5rem">${esc(r.title)}</h2><div class="small muted">${esc(r.subtitle || '')}</div></div></div>
        <div class="stats" style="padding:20px 20px 0">${r.summary.map((s) => `<div class="stat"><div class="lbl">${esc(s.label)}</div><div class="val" style="font-size:1.4rem">${s.type === 'money' ? money(s.value) : s.type === 'percent' ? `${Number(s.value).toFixed(1)}%` : num(s.value)}</div></div>`).join('')}</div>
        ${r.chart ? '<div class="chart-box" id="rchart"></div>' : ''}
      </section>
      <section class="card"><div class="card-head"><h2>${num(r.rows.length)} rows</h2><span class="small muted">Click a column to sort</span></div>
        ${r.rows.length ? `<div class="table-wrap"><table class="table"><thead><tr>${r.columns.map((c) => `<th class="sortable ${['money', 'number', 'percent'].includes(c.type) ? 'num' : ''}" data-sort="${c.key}" tabindex="0">${esc(c.label)}${state.sort === c.key ? `<span class="sort-ind">${state.order === 'asc' ? '▲' : '▼'}</span>` : ''}</th>`).join('')}</tr></thead>
          <tbody>${r.rows.map((row) => `<tr>${r.columns.map((c) => `<td class="${['money', 'number', 'percent'].includes(c.type) ? 'num' : ''}">${fmt(row[c.key], c.type)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : emptyState({ icon: 'chart', title: 'No data for this period', text: 'Try a wider date range.' })}
      </section>`;
    if (r.chart) {
      const asc = state.report === 'revenue' || state.report === 'occupancy';
      const labels = asc ? r.chart.labels : r.chart.labels.slice().reverse();
      const data = asc ? r.chart.series[0].data : r.chart.series[0].data.slice().reverse();
      const tick = (l) => (l.length === 10 ? date(l, { month: 'short', day: 'numeric' }) : l.length === 7 ? new Date(`${l}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' }) : l);
      renderChart($('#rchart'), { kind: r.chart.type === 'line' ? 'line' : 'bar', labels, series: [{ label: r.chart.series[0].label, data }], fmt: state.report === 'occupancy' ? (v) => `${Math.round(v)}%` : (v, axis) => (axis ? `₱${num(Math.round(v))}` : money(v)), tickLabel: tick, ariaLabel: r.title });
    }
  } catch (err) {
    out.innerHTML = errorState(err);
    out.querySelector('[data-retry]')?.addEventListener('click', load);
  }
}

app.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-report]');
  if (t) { state.report = t.dataset.report; state.sort = ''; app.querySelectorAll('[data-report]').forEach((b) => b.classList.toggle('active', b === t)); history.replaceState(null, '', `?report=${state.report}`); load(); }
  const s = e.target.closest('th[data-sort]');
  if (s) { state.order = state.sort === s.dataset.sort && state.order === 'desc' ? 'asc' : 'desc'; state.sort = s.dataset.sort; load(); }
  const x = e.target.closest('[data-export]');
  if (x) await withLoading(x, () => api.download(`/admin/reports/${state.report}`, { from: state.from, to: state.to, group: state.group, q: state.q, sort: state.sort, order: state.order, format: x.dataset.export }, `${state.report}-report.${x.dataset.export}`).catch(toastError));
  if (e.target.closest('#print')) window.print();
});
$('#preset').addEventListener('change', (e) => {
  if (e.target.value === 'custom') return;
  [state.from, state.to] = preset(e.target.value);
  $('#from').value = state.from;
  $('#to').value = state.to;
  if (['year', '365'].includes(e.target.value) && state.report === 'revenue') { state.group = 'month'; $('#group').value = 'month'; }
  load();
});
['#from', '#to'].forEach((s) => $(s).addEventListener('change', (e) => { if (!e.target.value) return; state[e.target.name] = e.target.value; $('#preset').value = 'custom'; load(); }));
$('#group').addEventListener('change', (e) => { state.group = e.target.value; load(); });
$('#q').addEventListener('input', debounce((e) => { state.q = e.target.value.trim(); load(); }, 350));
$('#f').addEventListener('submit', (e) => e.preventDefault());
load();
