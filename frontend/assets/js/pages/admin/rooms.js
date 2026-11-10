import { api } from '../../api.js';
import { $, esc, icon, badge, loadInto, emptyState, confirmDialog, toast, toastError, withLoading, debounce } from '../../ui.js';
import { initDashboard } from '/components/dashboard-shell.js';
import { formModal } from '/components/form-modal.js';

const app = $('#app');
await initDashboard({ area: 'ADMIN', active: 'rooms', title: 'Physical rooms' });
let rooms = [];
let types = [];

app.innerHTML = `<div class="page-head"><div><h1>Physical rooms</h1><p>Individual rooms guests are assigned to. Availability is calculated from these and active reservations.</p></div><div class="actions"><button class="btn btn-gold" id="add">${icon('plus')} Add room</button></div></div>
  <div class="card">
    <div class="toolbar">
      <div class="field grow"><label for="q">Search</label><input id="q" class="input" placeholder="Room number"></div>
      <div class="field"><label for="ft">Category</label><select id="ft" class="select"><option value="">All categories</option></select></div>
      <div class="field"><label for="fs">Housekeeping</label><select id="fs" class="select"><option value="">Any</option><option>CLEAN</option><option>DIRTY</option><option>CLEANING</option><option>MAINTENANCE</option></select></div>
      <div class="field"><label for="fa">Active</label><select id="fa" class="select"><option value="">All</option><option value="true">Active</option><option value="false">Inactive</option></select></div>
    </div>
    <div id="list"></div>
  </div>`;

async function load() {
  await loadInto($('#list'), async () => {
    ({ items: rooms } = await api.get('/admin/rooms', { q: $('#q').value.trim(), room_type_id: $('#ft').value, status: $('#fs').value, active: $('#fa').value }));
    $('#list').innerHTML = rooms.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Room</th><th>Category</th><th>Floor</th><th>Housekeeping</th><th>Occupancy</th><th>Active</th><th>Notes</th><th></th></tr></thead><tbody>
      ${rooms.map((r) => `<tr><td class="cell-main">${esc(r.room_number)}</td><td>${esc(r.room_type.name)}${r.room_type.status === 'ARCHIVED' ? ' <span class="badge badge-muted plain">archived</span>' : ''}</td><td>${r.floor}</td><td>${badge(r.housekeeping_status)}</td><td>${badge(r.occupancy)}${r.current_booking ? `<div class="cell-sub"><a href="/admin/booking-details.html?id=${r.current_booking.id}">${esc(r.current_booking.booking_reference)}</a></div>` : ''}</td><td>${r.is_active ? badge('ACTIVE') : badge('INACTIVE')}</td><td class="small muted">${esc(r.notes || '')}</td>
        <td><div class="actions"><button class="btn btn-outline btn-sm" data-edit="${r.id}">${icon('edit')} Edit</button><button class="btn btn-ghost btn-sm" data-del="${r.id}" title="Delete or deactivate">${icon('trash')}</button></div></td></tr>`).join('')}
      </tbody></table></div><div class="pagination"><span>${rooms.length} rooms · ${rooms.filter((r) => r.is_active).length} active</span></div>` : emptyState({ icon: 'door', title: 'No rooms found', text: 'Add physical rooms so they can be assigned to reservations.' });
  });
}

function edit(r) {
  formModal({
    title: r ? `Edit room ${r.room_number}` : 'Add room',
    fields: `
      <div class="field"><label for="rm-no">Room number</label><input id="rm-no" class="input" name="room_number" required maxlength="20" pattern="[A-Za-z0-9\\-]+" data-pattern-msg="Letters, digits and dashes only."><div class="field-error"></div></div>
      <div class="field"><label for="rm-fl">Floor</label><input id="rm-fl" class="input" type="number" name="floor" required min="-5" max="200" data-type="number"><div class="field-error"></div></div>
      <div class="field span-2"><label for="rm-type">Category</label><select id="rm-type" class="select" name="room_type_id" required data-type="number"><option value="">Choose…</option>${types.map((t) => `<option value="${t.id}">${esc(t.name)}${t.status === 'ARCHIVED' ? ' (archived)' : ''}</option>`).join('')}</select><div class="field-error"></div></div>
      <div class="field"><label for="rm-hk">Housekeeping status</label><select id="rm-hk" class="select" name="housekeeping_status"><option>CLEAN</option><option>DIRTY</option><option>CLEANING</option><option>MAINTENANCE</option></select><div class="hint">Rooms under maintenance are excluded from availability.</div><div class="field-error"></div></div>
      <div class="field"><span class="label">Status</span><label class="check" style="min-height:44px;align-items:center"><input type="checkbox" name="is_active"> <span>Active (bookable)</span></label></div>
      <div class="field span-2"><label for="rm-n">Notes</label><input id="rm-n" class="input" name="notes" maxlength="255"></div>`,
    values: r ? { ...r } : { is_active: true, housekeeping_status: 'CLEAN', floor: 1 },
    submitLabel: r ? 'Save room' : 'Add room',
    transform: (v) => ({ ...v, room_type_id: Number(v.room_type_id) }),
    onSubmit: async (p) => { const res = r ? await api.put(`/admin/rooms/${r.id}`, p) : await api.post('/admin/rooms', p); load(); return res; },
  });
}

app.addEventListener('click', async (e) => {
  if (e.target.closest('#add')) return edit(null);
  const ed = e.target.closest('[data-edit]');
  if (ed) return edit(rooms.find((r) => String(r.id) === ed.dataset.edit));
  const del = e.target.closest('[data-del]');
  if (del) {
    const r = rooms.find((x) => String(x.id) === del.dataset.del);
    if (!(await confirmDialog({ title: `Remove room ${esc(r.room_number)}?`, message: 'Rooms with booking history are deactivated instead of deleted, so reports stay accurate.', confirmText: 'Remove', danger: true }))) return;
    await withLoading(del, async () => { try { const res = await api.del(`/admin/rooms/${r.id}`); toast(res.message, 'success'); load(); } catch (err) { toastError(err); } });
  }
});
['#ft', '#fs', '#fa'].forEach((s) => $(s).addEventListener('change', load));
$('#q').addEventListener('input', debounce(load, 300));

({ items: types } = await api.get('/admin/room-types').catch(() => ({ items: [] })));
$('#ft').insertAdjacentHTML('beforeend', types.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join(''));
load();
