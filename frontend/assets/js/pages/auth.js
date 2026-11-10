import { api } from '../api.js';
import { $, esc, icon, params, validateForm, formValues, showErrors, withLoading, initPasswordFields, PASSWORD_RULE } from '../ui.js';
import { getUser, setUser, homeFor } from '../session.js';

const page = document.body.dataset.page;
const form = $('#form');
const notice = $('#notice');
const p = params();
const alertBox = (type, html) => `<div class="alert alert-${type} mt-2" role="${type === 'danger' ? 'alert' : 'status'}">${icon(type === 'success' ? 'checkCircle' : type === 'danger' ? 'alert' : 'info')}<div>${html}</div></div>`;

/** Only allow same-site relative redirects (prevents open redirects via ?next=). */
function safeNext(user) {
  const n = p.next || '';
  if (n.startsWith('/') && !n.startsWith('//') && !n.includes('://')) {
    if (n.startsWith('/admin') && user.role !== 'ADMIN') return homeFor(user);
    if (n.startsWith('/staff') && !['ADMIN', 'RECEPTIONIST'].includes(user.role)) return homeFor(user);
    if (n.startsWith('/customer') && user.role !== 'CUSTOMER') return homeFor(user);
    return n;
  }
  return homeFor(user);
}

const confirmRule = (v, f) => (v !== f.password.value ? 'Passwords do not match.' : '');

async function submit(handler) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('[type=submit]');
    const rules = {};
    if (form.confirm_password) rules.confirm_password = confirmRule;
    if (page !== 'login' && form.password) rules.password = PASSWORD_RULE;
    if (!validateForm(form, rules)) return;
    await withLoading(btn, async () => {
      try { await handler(formValues(form)); } catch (err) { showErrors(form, err); }
    });
  });
}

async function main() {
  initPasswordFields();
  if (page === 'login' || page === 'register') {
    const u = await getUser().catch(() => null);
    if (u) { location.replace(safeNext(u)); return; }
  }

  switch (page) {
    case 'login':
      if (p.reason === 'booking') notice.innerHTML = alertBox('info', 'Please log in or create an account to complete your booking.');
      if (p.reset === '1') notice.innerHTML = alertBox('success', 'Your password has been updated. Log in with your new password.');
      $('#demo').toggleAttribute('hidden', !['localhost', '127.0.0.1'].includes(location.hostname));
      document.querySelector('.switch a').href = `/register.html${p.next ? `?next=${encodeURIComponent(p.next)}` : ''}`;
      submit(async (v) => {
        const r = await api.post('/auth/login', { email: v.email, password: v.password });
        setUser(r.user);
        location.href = safeNext(r.user);
      });
      break;

    case 'register':
      submit(async (v) => {
        const r = await api.post('/auth/register', { first_name: v.first_name, last_name: v.last_name, email: v.email, phone: v.phone || undefined, password: v.password, confirm_password: v.confirm_password });
        setUser(r.user);
        sessionStorage.setItem('se.flash', r.message);
        location.href = p.next && p.next.startsWith('/') && !p.next.startsWith('//') ? p.next : '/customer/dashboard.html?welcome=1';
      });
      break;

    case 'forgot':
      submit(async (v) => {
        const r = await api.post('/auth/forgot-password', { email: v.email });
        form.reset();
        notice.innerHTML = alertBox('success', esc(r.message));
      });
      break;

    case 'reset':
      if (!p.token) { form.remove(); notice.innerHTML = alertBox('danger', 'This reset link is invalid. <a href="/forgot-password.html">Request a new one</a>.'); break; }
      submit(async (v) => {
        try {
          await api.post('/auth/reset-password', { token: p.token, password: v.password });
          location.href = '/login.html?reset=1';
        } catch (err) {
          if (err.status === 400 && !Object.keys(err.fields || {}).length) { form.remove(); notice.innerHTML = alertBox('danger', `${esc(err.message)} <a href="/forgot-password.html">Request a new link</a>.`); return; }
          throw err;
        }
      });
      break;

    case 'verify':
      if (!p.token) { notice.innerHTML = alertBox('danger', 'This verification link is invalid.'); break; }
      try {
        const r = await api.post('/auth/verify-email', { token: p.token });
        const u = await getUser({ refresh: true }).catch(() => null);
        notice.innerHTML = alertBox('success', `${esc(r.message)} You can now make reservations.`) + `<div class="row mt-3"><a class="btn" href="${u ? homeFor(u) : '/login.html'}">${u ? 'Go to my account' : 'Log in'}</a><a class="btn btn-outline" href="/rooms.html">Browse rooms</a></div>`;
      } catch (err) {
        notice.innerHTML = alertBox('danger', `${esc(err.message)} You can request a new link from your account dashboard.`) + '<a class="btn mt-3" href="/customer/dashboard.html">Go to my account</a>';
      }
      break;
    default:
  }
}

main();
