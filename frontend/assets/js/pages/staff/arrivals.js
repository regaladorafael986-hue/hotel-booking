// Shared by arrivals.html and departures.html
import { api } from '../../api.js';
import { $, date, today, loadInto, emptyState, icon } from '../../ui.js';
import { initDashboard } from '/components/dashboard-shell.js';
import { deskCard, bindDeskActions } from './common.js';

const mode = location.pathname.includes('departures') ? 'departure' : 'arrival';
const app = $('#app');
const user = await initDashboard({ area: 'RECEPTIONIST', active: mode === 'arrival' ? 'arrivals' : 'departures', title: mode === 'arrival' ? 'Arrivals' : 'Departures' });
let day = today();

app.innerHTML = `<div class="page-head"><div><h1>${mode === 'arrival' ? 'Arrivals' : 'Departures'}</h1><p id="sub"></p></div>
  <div class="actions"><button class="btn btn-outline btn-icon" data-shift="-1" aria-label="Previous day">${icon('chevronLeft')}</button><label for="day" class="sr-only">Date</label><input id="day" type="date" class="input" style="width:auto" value="${day}"><button class="btn btn-outline btn-icon" data-shift="1" aria-label="Next day">${icon('chevronRight')}</button><button class="btn btn-outline" data-today>Today</button></div></div>
  <div class="card"><div class="toolbar"><div class="field grow"><label for="q" class="sr-only">Filter</label><input id="q" class="input" placeholder="Filter by guest name, reference or room…"></div></div><div id="list"></div></div>`;

const list = $('#list');
let items = [];
function draw() {
  const q = $('#q').value.trim().toLowerCase();
  const shown = q ? items.filter((b) => `${b.guest_first_name} ${b.guest_last_name} ${b.booking_reference} ${b.rooms.map((r) => r.room.room_number).join(' ')}`.toLowerCase().includes(q)) : items;
  const pending = items.filter((b) => (mode === 'arrival' ? b.booking_status !== 'CHECKED_IN' : b.booking_status === 'CHECKED_IN')).length;
  $('#sub').textContent = `${date(day, { weekday: 'long', month: 'long', day: 'numeric' })} · ${items.length} total · ${pending} ${mode === 'arrival' ? 'awaiting check-in' : 'awaiting check-out'}`;
  list.innerHTML = shown.length ? shown.map((b) => deskCard(b, user, mode)).join('') : emptyState({ icon: mode === 'arrival' ? 'arrowRight' : 'logout', title: `No ${mode === 'arrival' ? 'arrivals' : 'departures'}`, text: q ? 'No matches for this filter.' : 'Nothing scheduled for this date.' });
}
async function load() {
  await loadInto(list, async () => {
    ({ items } = await api.get(mode === 'arrival' ? '/staff/arrivals' : '/staff/departures', day === today() ? {} : { date: day }));
    draw();
  });
}
app.addEventListener('click', (e) => {
  const s = e.target.closest('[data-shift]');
  if (s) { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + Number(s.dataset.shift)); day = d.toISOString().slice(0, 10); $('#day').value = day; load(); }
  if (e.target.closest('[data-today]')) { day = today(); $('#day').value = day; load(); }
});
$('#day').addEventListener('change', (e) => { if (e.target.value) { day = e.target.value; load(); } });
$('#q').addEventListener('input', draw);
bindDeskActions(list, user, load);
load();
