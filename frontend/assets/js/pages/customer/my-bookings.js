import { api } from '../../api.js';
import { $, $$, params, loadingState, emptyState, errorState, imgFallback, num } from '../../ui.js';
import { initDashboard } from '/components/dashboard-shell.js';
import { bookingTile } from './common.js';

const app = $('#app');
await initDashboard({ area: 'CUSTOMER', active: 'bookings', title: 'My bookings' });

const TABS = [['all', 'All'], ['upcoming', 'Upcoming'], ['current', 'Current'], ['completed', 'Completed'], ['cancelled', 'Cancelled']];
let tab = TABS.some(([k]) => k === params().tab) ? params().tab : 'all';
let page = 1;

app.innerHTML = `<div class="page-head"><div><h1>My bookings</h1><p>View, pay for, cancel or review your reservations.</p></div><div class="actions"><a class="btn btn-gold" href="/rooms.html">Book a new stay</a></div></div>
  <div class="card"><div class="tabs" role="tablist">${TABS.map(([k, l]) => `<button class="tab ${k === tab ? 'active' : ''}" role="tab" aria-selected="${k === tab}" data-tab="${k}">${l}</button>`).join('')}</div><div id="list"></div><div class="pagination hidden" id="pager"></div></div>`;

async function load() {
  const list = $('#list');
  const pager = $('#pager');
  list.innerHTML = loadingState();
  pager.classList.add('hidden');
  try {
    const r = await api.get('/bookings/my', { status: tab, page, page_size: 8 });
    list.innerHTML = r.items.length ? r.items.map(bookingTile).join('') : emptyState({ icon: 'calendar', title: 'No bookings here', text: tab === 'all' ? 'You have not made any reservations yet.' : `You have no ${tab} bookings.`, action: '<a class="btn" href="/rooms.html">Browse rooms</a>' });
    imgFallback(list);
    const p = r.pagination;
    if (p.total_pages > 1) {
      pager.classList.remove('hidden');
      pager.innerHTML = `<span>${num(p.total)} bookings</span><div class="pages"><button class="btn btn-outline btn-sm" data-p="${p.page - 1}" ${p.page <= 1 ? 'disabled' : ''}>Previous</button><span class="btn btn-ghost btn-sm">Page ${p.page} of ${p.total_pages}</span><button class="btn btn-outline btn-sm" data-p="${p.page + 1}" ${p.page >= p.total_pages ? 'disabled' : ''}>Next</button></div>`;
    }
  } catch (err) {
    list.innerHTML = errorState(err);
    list.querySelector('[data-retry]')?.addEventListener('click', load);
  }
}

app.addEventListener('click', (e) => {
  const t = e.target.closest('[data-tab]');
  if (t) {
    tab = t.dataset.tab;
    page = 1;
    $$('.tab', app).forEach((b) => { b.classList.toggle('active', b === t); b.setAttribute('aria-selected', String(b === t)); });
    history.replaceState(null, '', `?tab=${tab}`);
    load();
  }
  const pb = e.target.closest('[data-p]');
  if (pb && !pb.disabled) { page = Number(pb.dataset.p); load(); }
});
load();
