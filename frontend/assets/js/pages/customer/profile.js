import { api } from '../../api.js';
import { $, esc, icon, validateForm, formValues, showErrors, withLoading, toast, initPasswordFields, PASSWORD_RULE, dateTime } from '../../ui.js';
import { initDashboard } from '/components/dashboard-shell.js';
import { setUser } from '../../session.js';

const app = $('#app');
let user = await initDashboard({ area: 'CUSTOMER', active: 'profile', title: 'Profile & security' });

app.innerHTML = `<div class="page-head"><div><h1>Profile &amp; security</h1><p>Keep your details up to date for faster bookings.</p></div></div>
  <div class="dash-grid">
    <section class="card span-7"><div class="card-head"><h2>Personal details</h2></div><div class="card-body">
      <form id="profile" class="form-grid" novalidate>
        <div class="field"><label for="fn">First name</label><input id="fn" class="input" name="first_name" required maxlength="80" value="${esc(user.first_name)}"><div class="field-error"></div></div>
        <div class="field"><label for="ln">Last name</label><input id="ln" class="input" name="last_name" required maxlength="80" value="${esc(user.last_name)}"><div class="field-error"></div></div>
        <div class="field"><label for="em">Email</label><input id="em" class="input" value="${esc(user.email)}" disabled><div class="hint">${user.email_verified ? `${icon('checkCircle')} Verified` : `Not verified — <button type="button" class="link-btn" id="resend">resend link</button>`}</div></div>
        <div class="field"><label for="ph">Mobile number</label><input id="ph" class="input" type="tel" name="phone" maxlength="30" pattern="[+\\d][\\d\\s\\(\\)\\-]{6,24}" data-pattern-msg="Enter a valid phone number." value="${esc(user.phone || '')}"><div class="field-error"></div></div>
        <div class="span-2"><button class="btn" type="submit">Save changes</button></div>
      </form>
    </div></section>
    <section class="card span-5"><div class="card-head"><h2>Change password</h2></div><div class="card-body">
      <form id="password" class="stack" novalidate>
        <div class="field"><label for="cp">Current password</label><input id="cp" class="input" type="password" name="current_password" autocomplete="current-password" required data-password><div class="field-error"></div></div>
        <div class="field"><label for="np">New password</label><input id="np" class="input" type="password" name="new_password" autocomplete="new-password" required minlength="8" data-password data-meter><div class="hint">At least 8 characters with a letter and a number.</div><div class="field-error"></div></div>
        <div class="field"><label for="np2">Confirm new password</label><input id="np2" class="input" type="password" name="confirm" autocomplete="new-password" required data-password><div class="field-error"></div></div>
        <button class="btn" type="submit">Update password</button>
        <p class="small muted mb-0">Changing your password signs you out on other devices.</p>
      </form>
    </div></section>
    <section class="card span-12"><div class="card-body small muted">Member since ${dateTime(user.created_at)}</div></section>
  </div>`;
initPasswordFields(app);

const pf = $('#profile');
pf.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!validateForm(pf)) return;
  await withLoading(pf.querySelector('[type=submit]'), async () => {
    try {
      const r = await api.put('/auth/profile', formValues(pf));
      user = r.user;
      setUser(user);
      toast(r.message, 'success');
    } catch (err) { showErrors(pf, err); }
  });
});

const pw = $('#password');
pw.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!validateForm(pw, { new_password: PASSWORD_RULE, confirm: (v, f) => (v !== f.new_password.value ? 'Passwords do not match.' : '') })) return;
  await withLoading(pw.querySelector('[type=submit]'), async () => {
    try {
      const v = formValues(pw);
      const r = await api.put('/auth/password', { current_password: v.current_password, new_password: v.new_password });
      pw.reset();
      toast(r.message, 'success');
    } catch (err) { showErrors(pw, err); }
  });
});

$('#resend')?.addEventListener('click', async (e) => {
  await withLoading(e.currentTarget, async () => {
    try { await api.post('/auth/resend-verification'); toast('Verification email sent.', 'success'); } catch (err) { toast(err.message, 'error'); }
  });
});
