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

// Official-style brand marks for the sign-in buttons.
const BRAND = {
  google: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.7Z"/><path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24Z"/><path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.3a12 12 0 0 0 0 10.8l4-3.1Z"/><path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A11.5 11.5 0 0 0 12 0 12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9Z"/></svg>',
  facebook: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#fff" d="M24 12a12 12 0 1 0-13.9 11.9v-8.4H7.1V12h3V9.4c0-3 1.8-4.7 4.5-4.7 1.3 0 2.7.2 2.7.2v3h-1.5c-1.5 0-2 .9-2 1.9V12h3.4l-.5 3.5h-2.9v8.4A12 12 0 0 0 24 12Z"/></svg>',
};

/** Render "Continue with Google / Facebook" (+ "Continue with email" on the register page). */
async function renderSocial({ withEmailButton }) {
  const box = $('#social');
  if (!box) return;
  let providers = [];
  try { ({ items: providers } = await api.get('/auth/providers')); } catch { /* email sign-in still works */ }
  const next = p.next && p.next.startsWith('/') && !p.next.startsWith('//') ? `&next=${encodeURIComponent(p.next)}` : '';
  const verb = page === 'register' ? 'Sign up' : 'Continue';
  const buttons = providers.map((pr) => (pr.enabled
    ? `<a class="btn btn-social ${pr.id}" href="/api/v1/auth/oauth/${pr.id}/start?mode=login${next}">${BRAND[pr.id] || ''}${verb} with ${esc(pr.name)}</a>`
    : `<span class="btn btn-social ${pr.id}" aria-disabled="true" title="${esc(pr.name)} sign-in needs API keys — see README (Social sign-in)">${BRAND[pr.id] || ''}${verb} with ${esc(pr.name)}<span class="setup">Setup required</span></span>`)).join('');
  if (withEmailButton) {
    box.innerHTML = `<div class="social-stack">${buttons}<button type="button" class="btn btn-social" id="email-choice">${icon('mail')}${verb} with email</button></div>`;
    const reveal = () => {
      form.classList.remove('hidden');
      box.querySelector('#email-choice')?.remove();
      box.insertAdjacentHTML('beforeend', '<div class="or-divider">sign up with email</div>');
      form.querySelector('input')?.focus();
    };
    $('#email-choice').addEventListener('click', reveal);
    if (p.method === 'email') reveal();
  } else if (buttons) {
    box.innerHTML = `<div class="social-stack">${buttons}</div><div class="or-divider">or log in with email</div>`;
  }
}

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
      renderSocial({ withEmailButton: false });
      if (p.oauth_error) notice.innerHTML = alertBox('danger', esc(p.oauth_error));
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
      form.classList.add('hidden');
      renderSocial({ withEmailButton: true });
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
