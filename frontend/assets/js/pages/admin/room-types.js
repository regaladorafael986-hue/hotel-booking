import { api } from '../../api.js';
import { $, esc, icon, money, badge, loadInto, emptyState, modal, confirmDialog, toast, toastError, withLoading } from '../../ui.js';
import { amenityIcon } from '../../icons.js';
import { initDashboard } from '/components/dashboard-shell.js';
import { formModal } from '/components/form-modal.js';

const app = $('#app');
await initDashboard({ area: 'ADMIN', active: 'room-types', title: 'Room categories' });
let types = [];
let amenities = [];

app.innerHTML = `<div class="page-head"><div><h1>Room categories</h1><p>Prices, capacity, amenities and photos shown to guests.</p></div><div class="actions"><button class="btn btn-gold" id="add">${icon('plus')} Add category</button></div></div>
  <div class="card"><div class="toolbar"><div class="seg" role="group" aria-label="Status"><button class="active" data-s="ACTIVE">Active</button><button data-s="ARCHIVED">Archived</button><button data-s="">All</button></div></div><div id="list"></div></div>`;
let status = 'ACTIVE';

async function load() {
  await loadInto($('#list'), async () => {
    [{ items: types }, { items: amenities }] = await Promise.all([api.get('/admin/room-types', status ? { status } : {}), api.get('/admin/amenities')]);
    $('#list').innerHTML = types.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Category</th><th class="num">Base price</th><th>Capacity</th><th>Bed</th><th class="num">Rooms</th><th>Status</th><th></th></tr></thead><tbody>
      ${types.map((t) => `<tr><td><div class="row" style="flex-wrap:nowrap"><div style="width:64px;height:46px;border-radius:6px;overflow:hidden;background:var(--cream-200);flex:none">${t.primary_image ? `<img src="${esc(t.primary_image.replace(/w=\d+/, 'w=200'))}" alt="" style="width:100%;height:100%;object-fit:cover">` : ''}</div><div><div class="cell-main">${esc(t.name)} ${t.is_featured ? '<span class="badge badge-gold plain">Featured</span>' : ''}</div><div class="cell-sub">${t.images.length} photos · ${t.amenities.length} amenities</div></div></div></td>
        <td class="num">${money(t.base_price)}</td><td>${t.max_adults} adults${t.max_children ? ` + ${t.max_children} children` : ''}</td><td>${esc(t.bed_type)}</td><td class="num">${t.room_count ?? 0}</td><td>${badge(t.status)}</td>
        <td><div class="actions"><button class="btn btn-outline btn-sm" data-edit="${t.id}">${icon('edit')} Edit</button><button class="btn btn-outline btn-sm" data-images="${t.id}">${icon('image')} Photos</button>${t.status === 'ACTIVE' ? `<button class="btn btn-ghost btn-sm" data-archive="${t.id}" title="Archive">${icon('trash')}</button>` : `<button class="btn btn-ghost btn-sm" data-restore="${t.id}">Restore</button>`}</div></td></tr>`).join('')}
      </tbody></table></div>` : emptyState({ icon: 'bed', title: 'No room categories', text: status === 'ARCHIVED' ? 'Nothing archived.' : 'Add your first room category to start taking bookings.' });
  });
}

function fields() {
  return `
    <div class="field"><label for="rt-name">Name</label><input id="rt-name" class="input" name="name" required minlength="2" maxlength="100"><div class="field-error"></div></div>
    <div class="field"><label for="rt-price">Base price per night (₱)</label><input id="rt-price" class="input" type="number" name="base_price" required min="1" step="0.01" data-type="number"><div class="field-error"></div></div>
    <div class="field"><label for="rt-ad">Max adults</label><input id="rt-ad" class="input" type="number" name="max_adults" required min="1" max="20" data-type="number"><div class="field-error"></div></div>
    <div class="field"><label for="rt-ch">Max children</label><input id="rt-ch" class="input" type="number" name="max_children" required min="0" max="20" value="0" data-type="number"><div class="field-error"></div></div>
    <div class="field"><label for="rt-bed">Bed configuration</label><input id="rt-bed" class="input" name="bed_type" required minlength="2" maxlength="60" placeholder="e.g. King bed" list="bed-types"><datalist id="bed-types">${[...new Set(types.map((t) => t.bed_type))].map((b) => `<option value="${esc(b)}">`).join('')}</datalist><div class="field-error"></div></div>
    <div class="field"><label for="rt-size">Size (m²)</label><input id="rt-size" class="input" type="number" name="size_sqm" min="1" max="2000" data-type="number"><div class="field-error"></div></div>
    <div class="field span-2"><label for="rt-short">Short description</label><input id="rt-short" class="input" name="short_description" maxlength="255" placeholder="One line shown on room cards"><div class="field-error"></div></div>
    <div class="field span-2"><label for="rt-desc">Full description</label><textarea id="rt-desc" class="textarea" name="description" maxlength="5000"></textarea><div class="field-error"></div></div>
    <div class="field span-2"><span class="label">Amenities</span><div class="chips">${amenities.map((a) => `<label class="chip-check"><input type="checkbox" name="amenity_ids" value="${a.id}" data-type="array"><span>${amenityIcon(a.icon)}${esc(a.name)}</span></label>`).join('') || '<span class="muted small">No amenities yet — add them on the Amenities page.</span>'}</div></div>
    <div class="field span-2"><label class="check"><input type="checkbox" name="is_featured"> <span>Feature this category on the homepage</span></label></div>`;
}

function edit(t) {
  formModal({
    title: t ? `Edit ${t.name}` : 'Add room category',
    wide: true,
    fields: fields(),
    values: t ? { ...t, amenity_ids: t.amenities.map((a) => a.id) } : { max_adults: 2, max_children: 0, amenity_ids: [] },
    submitLabel: t ? 'Save changes' : 'Create category',
    transform: (v) => ({ ...v, size_sqm: v.size_sqm || null, amenity_ids: v.amenity_ids || [] }),
    onSubmit: async (payload) => {
      const r = t ? await api.put(`/admin/room-types/${t.id}`, payload) : await api.post('/admin/room-types', payload);
      load();
      if (!t) setTimeout(() => toast('Next: add photos and physical rooms for this category.'), 600);
      return r;
    },
  });
}

async function photos(id) {
  const { el, close } = modal({ title: 'Photos', wide: true, body: '<div class="state"><div class="spinner"></div></div>', actions: [{ label: 'Done' }], onClose: () => load() });
  const body = el.querySelector('.modal-body');
  async function draw() {
    const { room_type: t } = await api.get(`/admin/room-types/${id}`);
    el.querySelector('#modal-title').textContent = `Photos — ${t.name}`;
    body.innerHTML = `<label class="dropzone mb-2" id="dz">${icon('upload')}<div><strong>Click to upload</strong> or drag photos here</div><div class="small">JPG, PNG or WEBP · max 5 MB each · up to 10 at a time</div><input type="file" accept="image/jpeg,image/png,image/webp" multiple class="sr-only" id="file"></label>
      ${t.images.length ? `<div class="img-thumbs">${t.images.map((i) => `<div class="img-thumb ${i.is_primary ? 'primary' : ''}"><img src="${esc(i.image_url.replace(/w=\d+/, 'w=400'))}" alt="">${i.is_primary ? '<span class="tag badge badge-gold plain">Cover</span>' : ''}<div class="tools">${i.is_primary ? '' : `<button data-primary="${i.id}">Set cover</button>`}<button data-del="${i.id}" style="color:var(--danger)">Delete</button></div></div>`).join('')}</div>` : emptyState({ icon: 'image', title: 'No photos yet', text: 'Categories with photos convert much better.' })}`;
  }
  async function upload(files) {
    const list = [...files];
    if (!list.length) return;
    const bad = list.find((f) => !['image/jpeg', 'image/png', 'image/webp'].includes(f.type) || f.size > 5 * 1024 * 1024);
    if (bad) return toast(`${bad.name}: only JPG/PNG/WEBP up to 5 MB.`, 'error');
    const fd = new FormData();
    list.slice(0, 10).forEach((f) => fd.append('images', f));
    body.querySelector('#dz').classList.add('skeleton');
    try { const r = await api.upload(`/admin/room-types/${id}/images`, fd); toast(r.message, 'success'); } catch (err) { toastError(err); }
    await draw();
  }
  body.addEventListener('change', (e) => { if (e.target.id === 'file') upload(e.target.files); });
  body.addEventListener('dragover', (e) => { e.preventDefault(); body.querySelector('#dz')?.classList.add('drag'); });
  body.addEventListener('dragleave', () => body.querySelector('#dz')?.classList.remove('drag'));
  body.addEventListener('drop', (e) => { e.preventDefault(); upload(e.dataTransfer.files); });
  body.addEventListener('click', async (e) => {
    const p = e.target.closest('[data-primary]');
    const d = e.target.closest('[data-del]');
    try {
      if (p) { await api.put(`/admin/room-types/${id}/images/${p.dataset.primary}/primary`); await draw(); }
      if (d && await confirmDialog({ title: 'Delete photo?', message: 'This photo will be removed from the website.', confirmText: 'Delete', danger: true })) { await api.del(`/admin/room-types/${id}/images/${d.dataset.del}`); await draw(); }
    } catch (err) { toastError(err); }
  });
  try { await draw(); } catch (err) { close(); toastError(err); }
}

app.addEventListener('click', async (e) => {
  const s = e.target.closest('[data-s]');
  if (s) { status = s.dataset.s; app.querySelectorAll('[data-s]').forEach((b) => b.classList.toggle('active', b === s)); load(); return; }
  if (e.target.closest('#add')) return edit(null);
  const ed = e.target.closest('[data-edit]');
  if (ed) return edit(types.find((t) => String(t.id) === ed.dataset.edit));
  const im = e.target.closest('[data-images]');
  if (im) return photos(Number(im.dataset.images));
  const ar = e.target.closest('[data-archive]');
  if (ar) {
    const t = types.find((x) => String(x.id) === ar.dataset.archive);
    if (!(await confirmDialog({ title: `Archive ${esc(t.name)}?`, message: 'Archived categories are hidden from guests and cannot be booked. Past reservations are kept.', confirmText: 'Archive', danger: true }))) return;
    await withLoading(ar, async () => { try { const r = await api.del(`/admin/room-types/${t.id}`); toast(r.message, 'success'); load(); } catch (err) { toastError(err); } });
  }
  const rs = e.target.closest('[data-restore]');
  if (rs) await withLoading(rs, async () => { try { await api.put(`/admin/room-types/${rs.dataset.restore}`, { status: 'ACTIVE' }); toast('Category restored.', 'success'); load(); } catch (err) { toastError(err); } });
});
load();
