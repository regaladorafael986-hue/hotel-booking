import { api } from '../../api.js';
import { $, esc, icon, badge, dateTime, loadInto, emptyState, initials, initPasswordFields, PASSWORD_RULE } from '../../ui.js';
import { initDashboard } from '/components/dashboard-shell.js';
import { formModal } from '/components/form-modal.js';

const app = $('#app');
const me = await initDashboard({ area: 'ADMIN', active: 'staff', title: 'Staff accounts' });
let staff = [];
let PERMS = {};

app.innerHTML = `<div class="page-head"><div><h1>Staff accounts</h1><p>Receptionist logins and what each can do at the front desk.</p></div><div class="actions"><button class="btn btn-gold" id="add">${icon('plus')} Add receptionist</button></div></div><div class="card" id="list"></div>`;

async function load() {
  await loadInto($('#list'), async () => {
    ({ items: staff, permissions: PERMS } = await api.get('/admin/staff'));
    $('#list').innerHTML = staff.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Name</th><th>Role</th><th>Permissions</th><th>Last login</th><th>Status</th><th></th></tr></thead><tbody>
      ${staff.map((u) => `<tr><td><div class="row" style="flex-wrap:nowrap"><span class="avatar">${esc(initials(u.first_name, u.last_name))}</span><div><div class="cell-main">${esc(u.first_name)} ${esc(u.last_name)}${u.id === me.id ? ' <span class="badge badge-muted plain">You</span>' : ''}</div><div class="cell-sub">${esc(u.email)}${u.phone ? ` · ${esc(u.phone)}` : ''}</div></div></div></td>
        <td>${badge(u.role)}</td><td class="small">${u.role === 'ADMIN' ? '<span class="muted">All permissions</span>' : `${u.permissions.length}/${Object.keys(PERMS).length} <span class="muted">· ${esc(u.permissions.map((p) => PERMS[p]?.split(' ')[0]).join(', '))}</span>`}</td>
        <td class="small nowrap">${u.last_login_at ? dateTime(u.last_login_at) : '<span class="muted">Never</span>'}</td><td>${badge(u.account_status)}</td>
        <td><div class="actions">${u.role === 'RECEPTIONIST' ? `<button class="btn btn-outline btn-sm" data-edit="${u.id}">${icon('edit')} Edit</button>` : ''}</div></td></tr>`).join('')}
    </tbody></table></div>` : emptyState({ icon: 'key', title: 'No staff accounts' });
  });
}

const permFields = () => `<div class="field span-2"><span class="label">Permissions</span><div class="perm-grid">${Object.entries(PERMS).map(([k, l]) => `<label class="check"><input type="checkbox" name="permissions" value="${k}" data-type="array"> <span>${esc(l)}</span></label>`).join('')}</div></div>`;

function edit(u) {
  const form = formModal({
    title: u ? `Edit ${u.first_name} ${u.last_name}` : 'Add receptionist',
    wide: true,
    fields: `
      <div class="field"><label for="s-fn">First name</label><input id="s-fn" class="input" name="first_name" required maxlength="80"><div class="field-error"></div></div>
      <div class="field"><label for="s-ln">Last name</label><input id="s-ln" class="input" name="last_name" required maxlength="80"><div class="field-error"></div></div>
      <div class="field"><label for="s-em">Email (login)</label><input id="s-em" class="input" type="email" name="email" required maxlength="191" ${u ? 'disabled' : ''}><div class="field-error"></div></div>
      <div class="field"><label for="s-ph">Phone</label><input id="s-ph" class="input" type="tel" name="phone" maxlength="30"><div class="field-error"></div></div>
      <div class="field"><label for="s-pw">${u ? 'Reset password' : 'Temporary password'}</label><input id="s-pw" class="input" type="password" name="password" ${u ? '' : 'required'} autocomplete="new-password" data-password><div class="hint">${u ? 'Leave blank to keep the current password.' : 'Share it securely; they can change it after logging in.'}</div><div class="field-error"></div></div>
      ${u ? `<div class="field"><label for="s-st">Account status</label><select id="s-st" class="select" name="account_status"><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive (cannot log in)</option></select></div>` : '<div></div>'}
      ${permFields()}`,
    values: u ? { ...u } : { permissions: Object.keys(PERMS) },
    rules: { password: (v) => (v ? PASSWORD_RULE(v) : '') },
    submitLabel: u ? 'Save changes' : 'Create account',
    transform: (v) => { const p = { ...v, permissions: v.permissions || [] }; if (u) { delete p.email; if (!p.password) delete p.password; } return p; },
    onSubmit: async (p) => { const r = u ? await api.put(`/admin/staff/${u.id}`, p) : await api.post('/admin/staff', p); load(); return r; },
  });
  initPasswordFields(form);
}

app.addEventListener('click', (e) => {
  if (e.target.closest('#add')) return edit(null);
  const ed = e.target.closest('[data-edit]');
  if (ed) edit(staff.find((u) => String(u.id) === ed.dataset.edit));
});
load();
