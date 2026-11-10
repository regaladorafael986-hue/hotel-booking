import { api } from '../../api.js';
import { $, esc, badge, loadInto, emptyState, modal, toast, withLoading, showErrors, formValues, date, icon } from '../../ui.js';
import { initDashboard } from '/components/dashboard-shell.js';
import { can } from '../../session.js';
import { bookingHref } from './common.js';

const app = $('#app');
const user = await initDashboard({ area: 'RECEPTIONIST', active: 'room-status', title: 'Room status' });
const STATUSES = ['CLEAN', 'DIRTY', 'CLEANING', 'MAINTENANCE'];
let rooms = [];
let filter = '';

app.innerHTML = `<div class="page-head"><div><h1>Room status</h1><p>Housekeeping and occupancy for every physical room.</p></div><div class="actions"><button class="btn btn-outline" id="refresh">${icon('refresh')} Refresh</button></div></div>
  <div class="card mb-3"><div class="toolbar">
    <div class="seg" role="group" aria-label="Filter by status"><button class="active" data-f="">All</button>${STATUSES.map((s) => `<button data-f="${s}">${s.charAt(0) + s.slice(1).toLowerCase()}</button>`).join('')}<button data-f="OCCUPIED">Occupied</button></div>
    <div class="row small muted" style="margin-left:auto">${STATUSES.map((s) => badge(s)).join(' ')}</div>
  </div></div>
  <div id="board"></div>`;

function draw() {
  const shown = rooms.filter((r) => r.is_active && (!filter || r.housekeeping_status === filter || r.occupancy === filter));
  const floors = [...new Set(shown.map((r) => r.floor))].sort((a, b) => a - b);
  $('#board').innerHTML = shown.length ? floors.map((f) => `<section class="card mb-3"><div class="card-head"><h2>Floor ${f}</h2><span class="small muted">${shown.filter((r) => r.floor === f).length} rooms</span></div><div class="card-body"><div class="room-board">
    ${shown.filter((r) => r.floor === f).map((r) => `<button type="button" class="room-tile hk-${r.housekeeping_status} occ-${r.occupancy}" data-id="${r.id}" aria-label="Room ${esc(r.room_number)}, ${r.housekeeping_status.toLowerCase()}, ${r.occupancy.toLowerCase().replace('_', ' ')}">
      <span class="no">${esc(r.room_number)}</span><span class="type">${esc(r.room_type.name)}</span>${badge(r.housekeeping_status)}
      <span class="small ${r.occupancy === 'OCCUPIED' ? '' : 'muted'}">${r.occupancy === 'OCCUPIED' ? `${icon('user')} ${esc(r.current_booking.guest_last_name)}` : r.occupancy === 'ARRIVING_TODAY' ? `${icon('arrowRight')} Arriving: ${esc(r.current_booking.guest_last_name)}` : 'Vacant'}</span>
    </button>`).join('')}
  </div></div></section>`).join('') : emptyState({ icon: 'door', title: 'No rooms match this filter' });
}

async function load() {
  await loadInto($('#board'), async () => { ({ items: rooms } = await api.get('/staff/rooms')); draw(); });
}

function openRoom(r) {
  const editable = can(user, 'housekeeping');
  modal({
    title: `Room ${r.room_number} · ${r.room_type.name}`,
    body: `<dl class="kv mb-2"><dt>Floor</dt><dd>${r.floor}</dd><dt>Status</dt><dd>${badge(r.housekeeping_status)} ${badge(r.occupancy)}</dd>
        ${r.current_booking ? `<dt>Guest</dt><dd><a href="${bookingHref(user, r.current_booking.id)}">${esc(r.current_booking.guest_first_name)} ${esc(r.current_booking.guest_last_name)} · ${esc(r.current_booking.booking_reference)}</a>${r.current_booking.check_out ? `<br><span class="small muted">Departs ${date(r.current_booking.check_out)}</span>` : ''}</dd>` : ''}</dl>
      ${editable ? `<form id="hk-form" class="stack" novalidate>
        <fieldset class="field" style="border:0;padding:0;margin:0"><legend class="label mb-1">Set housekeeping status</legend><div class="chips">${STATUSES.map((s) => `<label class="chip-check"><input type="radio" name="housekeeping_status" value="${s}" ${s === r.housekeeping_status ? 'checked' : ''}><span>${s.charAt(0) + s.slice(1).toLowerCase()}</span></label>`).join('')}</div><div class="field-error"></div></fieldset>
        <div class="field"><label for="hk-notes">Notes</label><input id="hk-notes" class="input" name="notes" maxlength="255" value="${esc(r.notes || '')}" placeholder="e.g. Extra towels requested"></div>
      </form>` : '<p class="muted mb-0">You do not have permission to change housekeeping status.</p>'}`,
    actions: editable ? [{ label: 'Close' }, {
      label: 'Save status', cls: 'btn',
      onClick: async (close, m, btn) => {
        const form = m.querySelector('#hk-form');
        await withLoading(btn, async () => {
          try {
            const r2 = await api.put(`/staff/rooms/${r.id}/housekeeping`, formValues(form));
            close();
            toast(r2.message, 'success');
            load();
          } catch (err) { showErrors(form, err); }
        });
      },
    }] : [{ label: 'Close' }],
  });
}

app.addEventListener('click', (e) => {
  const f = e.target.closest('[data-f]');
  if (f) { filter = f.dataset.f; app.querySelectorAll('[data-f]').forEach((b) => b.classList.toggle('active', b === f)); draw(); }
  const t = e.target.closest('.room-tile');
  if (t) openRoom(rooms.find((r) => String(r.id) === t.dataset.id));
  if (e.target.closest('#refresh')) load();
});
load();
