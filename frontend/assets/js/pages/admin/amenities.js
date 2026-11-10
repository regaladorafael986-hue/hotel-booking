import { api } from '../../api.js';
import { $, esc, icon, loadInto, emptyState, confirmDialog, toast, toastError } from '../../ui.js';
import { amenityIcon } from '../../icons.js';
import { initDashboard } from '/components/dashboard-shell.js';
import { formModal } from '/components/form-modal.js';

const app = $('#app');
await initDashboard({ area: 'ADMIN', active: 'amenities', title: 'Amenities' });
const ICONS = ['wifi', 'snow', 'tv', 'shower', 'bath', 'glass', 'coffee', 'lock', 'desk', 'city', 'sofa', 'kitchen', 'robe', 'breakfast', 'star', 'pool', 'dining', 'spa', 'dumbbell', 'car', 'sparkle'];
let items = [];

app.innerHTML = `<div class="page-head"><div><h1>Amenities</h1><p>Features you can attach to room categories.</p></div><div class="actions"><button class="btn btn-gold" id="add">${icon('plus')} Add amenity</button></div></div><div class="card" id="list"></div>`;

async function load() {
  await loadInto($('#list'), async () => {
    ({ items } = await api.get('/admin/amenities'));
    $('#list').innerHTML = items.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Amenity</th><th>Description</th><th class="num">Used by</th><th></th></tr></thead><tbody>
      ${items.map((a) => `<tr><td><span class="row" style="gap:10px">${amenityIcon(a.icon)}<span class="cell-main">${esc(a.name)}</span></span></td><td class="small muted">${esc(a.description || '')}</td><td class="num">${a.room_type_count} categor${a.room_type_count === 1 ? 'y' : 'ies'}</td><td><div class="actions"><button class="btn btn-outline btn-sm" data-edit="${a.id}">${icon('edit')} Edit</button><button class="btn btn-ghost btn-sm" data-del="${a.id}" title="Delete">${icon('trash')}</button></div></td></tr>`).join('')}
    </tbody></table></div>` : emptyState({ icon: 'sparkle', title: 'No amenities yet' });
  });
}

function edit(a) {
  formModal({
    title: a ? `Edit ${a.name}` : 'Add amenity',
    fields: `<div class="field span-2"><label for="am-n">Name</label><input id="am-n" class="input" name="name" required minlength="2" maxlength="80"><div class="field-error"></div></div>
      <div class="field span-2"><span class="label">Icon</span><div class="chips">${ICONS.map((i) => `<label class="chip-check" title="${i}"><input type="radio" name="icon" value="${i}"><span>${amenityIcon(i)}</span></label>`).join('')}</div></div>
      <div class="field span-2"><label for="am-d">Description</label><input id="am-d" class="input" name="description" maxlength="255"></div>`,
    values: a || { icon: 'sparkle' },
    onSubmit: async (p) => { const r = a ? await api.put(`/admin/amenities/${a.id}`, p) : await api.post('/admin/amenities', p); load(); return r; },
  });
}

app.addEventListener('click', async (e) => {
  if (e.target.closest('#add')) return edit(null);
  const ed = e.target.closest('[data-edit]');
  if (ed) return edit(items.find((a) => String(a.id) === ed.dataset.edit));
  const d = e.target.closest('[data-del]');
  if (d) {
    const a = items.find((x) => String(x.id) === d.dataset.del);
    if (!(await confirmDialog({ title: `Delete ${esc(a.name)}?`, message: a.room_type_count ? `It will be removed from ${a.room_type_count} room categor${a.room_type_count === 1 ? 'y' : 'ies'}.` : 'This cannot be undone.', confirmText: 'Delete', danger: true }))) return;
    try { const r = await api.del(`/admin/amenities/${a.id}`); toast(r.message, 'success'); load(); } catch (err) { toastError(err); }
  }
});
load();
