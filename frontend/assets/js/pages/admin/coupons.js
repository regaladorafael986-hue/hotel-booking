import { api } from '../../api.js';
import { $, esc, icon, money, date, badge, confirmDialog, toast, toastError, today, addDaysStr, debounce } from '../../ui.js';
import { initDashboard } from '/components/dashboard-shell.js';
import { dataTable } from '/components/data-table.js';
import { formModal } from '/components/form-modal.js';

const app = $('#app');
await initDashboard({ area: 'ADMIN', active: 'coupons', title: 'Promotions' });

app.innerHTML = `<div class="page-head"><div><h1>Promotions &amp; coupons</h1><p>Discount codes guests can apply at checkout. Featured live codes appear on the homepage.</p></div><div class="actions"><button class="btn btn-gold" id="add">${icon('plus')} New promotion</button></div></div>
  <div class="card"><div class="toolbar"><div class="field grow"><label for="q">Search</label><input id="q" class="input" placeholder="Code or description"></div><div class="field"><label for="s">Status</label><select id="s" class="select"><option value="">All</option><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select></div></div><div id="t"></div></div>`;

const discount = (c) => (c.discount_type === 'PERCENTAGE' ? `${c.discount_value}%${c.maximum_discount ? ` <span class="cell-sub">max ${money(c.maximum_discount)}</span>` : ''}` : money(c.discount_value));
let rows = [];
const table = dataTable($('#t'), {
  sortable: false,
  empty: { icon: 'tag', title: 'No promotions yet', text: 'Create a code to reward guests who book direct.' },
  fetch: async (s) => { const r = await api.get('/admin/coupons', { q: $('#q').value.trim(), status: $('#s').value, page: s.page }); rows = r.items; return r; },
  columns: [
    { key: 'code', label: 'Code', render: (c) => `<div class="cell-main" style="letter-spacing:.06em">${esc(c.code)} ${c.is_featured ? '<span class="badge badge-gold plain">Featured</span>' : ''}</div><div class="cell-sub">${esc(c.description || '')}</div>` },
    { key: 'discount', label: 'Discount', render: discount },
    { key: 'min', label: 'Min. booking', cls: 'num', render: (c) => (c.minimum_amount ? money(c.minimum_amount) : '—') },
    { key: 'valid', label: 'Valid', cls: 'nowrap', render: (c) => `${date(c.start_date, { month: 'short', day: 'numeric' })} – ${date(c.end_date, { month: 'short', day: 'numeric', year: 'numeric' })}` },
    { key: 'usage', label: 'Used', cls: 'num', render: (c) => `${c.used_count}${c.usage_limit ? ` / ${c.usage_limit}` : ''}` },
    { key: 'state', label: 'State', render: (c) => badge(c.state) },
    { key: 'a', label: '', render: (c) => `<div class="actions"><button class="btn btn-outline btn-sm" data-edit="${c.id}">${icon('edit')} Edit</button><button class="btn btn-ghost btn-sm" data-toggle="${c.id}">${c.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}</button><button class="btn btn-ghost btn-sm" data-del="${c.id}" title="Delete">${icon('trash')}</button></div>` },
  ],
});

function edit(c) {
  formModal({
    title: c ? `Edit ${c.code}` : 'New promotion',
    wide: true,
    fields: `
      <div class="field"><label for="c-code">Code</label><input id="c-code" class="input" name="code" required minlength="3" maxlength="40" pattern="[A-Za-z0-9_\\-]+" data-pattern-msg="Letters, digits, dashes and underscores only." style="text-transform:uppercase"><div class="field-error"></div></div>
      <div class="field"><label for="c-type">Discount type</label><select id="c-type" class="select" name="discount_type"><option value="PERCENTAGE">Percentage (%)</option><option value="FIXED">Fixed amount (₱)</option></select></div>
      <div class="field"><label for="c-val">Discount value</label><input id="c-val" class="input" type="number" name="discount_value" required min="0.01" step="0.01" data-type="number"><div class="field-error"></div></div>
      <div class="field"><label for="c-max">Maximum discount (₱)</label><input id="c-max" class="input" type="number" name="maximum_discount" min="0" step="0.01" data-type="number"><div class="hint">Optional cap for percentage codes.</div><div class="field-error"></div></div>
      <div class="field"><label for="c-min">Minimum booking amount (₱)</label><input id="c-min" class="input" type="number" name="minimum_amount" min="0" step="0.01" value="0" data-type="number"><div class="field-error"></div></div>
      <div class="field"><label for="c-lim">Usage limit</label><input id="c-lim" class="input" type="number" name="usage_limit" min="1" step="1" data-type="number"><div class="hint">Leave blank for unlimited.</div><div class="field-error"></div></div>
      <div class="field"><label for="c-start">Start date</label><input id="c-start" class="input" type="date" name="start_date" required><div class="field-error"></div></div>
      <div class="field"><label for="c-end">End date</label><input id="c-end" class="input" type="date" name="end_date" required><div class="field-error"></div></div>
      <div class="field span-2"><label for="c-desc">Description (shown to guests)</label><input id="c-desc" class="input" name="description" maxlength="255"></div>
      <div class="field"><label for="c-st">Status</label><select id="c-st" class="select" name="status"><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select></div>
      <div class="field"><span class="label">Homepage</span><label class="check" style="min-height:44px;align-items:center"><input type="checkbox" name="is_featured"> <span>Feature in “Special offers”</span></label></div>`,
    values: c ? { ...c } : { discount_type: 'PERCENTAGE', start_date: today(), end_date: addDaysStr(today(), 30), status: 'ACTIVE', minimum_amount: 0 },
    rules: {
      end_date: (v, form) => (v < form.start_date.value ? 'End date must be on or after the start date.' : ''),
      discount_value: (v, form) => (form.discount_type.value === 'PERCENTAGE' && Number(v) > 100 ? 'Percentage cannot exceed 100.' : ''),
    },
    transform: (v) => ({ ...v, code: v.code.toUpperCase(), maximum_discount: v.maximum_discount ?? null, usage_limit: v.usage_limit ?? null, minimum_amount: v.minimum_amount ?? 0 }),
    submitLabel: c ? 'Save' : 'Create promotion',
    onSubmit: async (p) => { const r = c ? await api.put(`/admin/coupons/${c.id}`, p) : await api.post('/admin/coupons', p); table.reload(); return r; },
  });
}

app.addEventListener('click', async (e) => {
  if (e.target.closest('#add')) return edit(null);
  const find = (el, k) => rows.find((c) => String(c.id) === el.dataset[k]);
  const ed = e.target.closest('[data-edit]');
  if (ed) return edit(find(ed, 'edit'));
  const tg = e.target.closest('[data-toggle]');
  if (tg) {
    const c = find(tg, 'toggle');
    try { await api.put(`/admin/coupons/${c.id}`, { status: c.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' }); toast(`${c.code} ${c.status === 'ACTIVE' ? 'deactivated' : 'activated'}.`, 'success'); table.reload(); } catch (err) { toastError(err); }
  }
  const d = e.target.closest('[data-del]');
  if (d) {
    const c = find(d, 'del');
    if (!(await confirmDialog({ title: `Delete ${esc(c.code)}?`, message: 'Codes already used by bookings are deactivated instead of deleted.', confirmText: 'Delete', danger: true }))) return;
    try { const r = await api.del(`/admin/coupons/${c.id}`); toast(r.message, 'success'); table.reload(); } catch (err) { toastError(err); }
  }
});
$('#q').addEventListener('input', debounce(() => table.reset(), 300));
$('#s').addEventListener('change', () => table.reset());
table.reset();
