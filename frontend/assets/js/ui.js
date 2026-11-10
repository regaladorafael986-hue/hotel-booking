// Shared UI helpers: DOM, formatting, toasts, modals, states, forms.
import { icon } from './icons.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const params = () => Object.fromEntries(new URLSearchParams(location.search));
export const debounce = (fn, ms = 300) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
export const TZ = 'Asia/Manila';

// ───── Formatting ─────
const pesoFmt = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', minimumFractionDigits: 2 });
const pesoShort = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 0 });
export const money = (n) => pesoFmt.format(Number(n || 0));
export const moneyShort = (n) => pesoShort.format(Number(n || 0));
export const num = (n) => Number(n || 0).toLocaleString('en-PH');
/** 'YYYY-MM-DD' → 'Thu, Nov 12, 2026' (date-only, no timezone shift) */
export function date(d, opts = { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) {
  if (!d) return '—';
  const s = String(d).slice(0, 10);
  return new Date(`${s}T00:00:00Z`).toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' });
}
export const shortDate = (d) => date(d, { month: 'short', day: 'numeric' });
export const dateTime = (d) => (d ? new Date(d).toLocaleString('en-PH', { timeZone: TZ, month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');
export const time = (d) => (d ? new Date(d).toLocaleTimeString('en-PH', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }) : '—');
export function ago(d) {
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)} d ago`;
  return dateTime(d);
}
/** Today's date in the hotel timezone as YYYY-MM-DD. */
export function today(offsetDays = 0) {
  const s = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const d = new Date(`${s}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}
export const addDaysStr = (s, n) => { const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const nightsBetween = (a, b) => Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 864e5);
export const initials = (f = '', l = '') => `${f.charAt(0)}${l.charAt(0)}`.toUpperCase() || '?';
export const plural = (n, word, pl = `${word}s`) => `${n} ${n === 1 ? word : pl}`;
export const stars = (r) => `<span class="stars" aria-label="${r} out of 5 stars">${'★'.repeat(r)}<span class="off">${'★'.repeat(5 - r)}</span></span>`;

const STATUS = {
  PENDING_PAYMENT: ['Awaiting payment', 'warning'], PENDING_CONFIRMATION: ['Awaiting confirmation', 'warning'], CONFIRMED: ['Confirmed', 'info'],
  CHECKED_IN: ['Checked in', 'success'], CHECKED_OUT: ['Checked out', 'muted'], CANCELLED: ['Cancelled', 'danger'], EXPIRED: ['Expired', 'muted'],
  PENDING: ['Pending', 'warning'], PAID: ['Paid', 'success'], FAILED: ['Failed', 'danger'], PARTIALLY_REFUNDED: ['Partially refunded', 'info'], REFUNDED: ['Refunded', 'muted'],
  SUCCEEDED: ['Succeeded', 'success'], REQUESTED: ['Cancellation requested', 'warning'], APPROVED: ['Approved', 'success'], REJECTED: ['Rejected', 'danger'],
  ACTIVE: ['Active', 'success'], INACTIVE: ['Inactive', 'muted'], ARCHIVED: ['Archived', 'muted'],
  CLEAN: ['Clean', 'success'], DIRTY: ['Dirty', 'danger'], CLEANING: ['Cleaning', 'warning'], MAINTENANCE: ['Maintenance', 'muted'],
  LIVE: ['Live', 'success'], SCHEDULED: ['Scheduled', 'info'], USED_UP: ['Used up', 'muted'],
  OCCUPIED: ['Occupied', 'navy'], VACANT: ['Vacant', 'muted'], ARRIVING_TODAY: ['Arriving today', 'gold'],
  ADMIN: ['Administrator', 'navy'], RECEPTIONIST: ['Receptionist', 'gold'], CUSTOMER: ['Customer', 'muted'],
  ONLINE: ['Online', 'info'], WALK_IN: ['Walk-in', 'gold'], PAY_AT_HOTEL: ['Pay at hotel', 'gold'],
};
export function badge(status, labelOverride) {
  const [label, tone] = STATUS[status] || [String(status || '—').replace(/_/g, ' ').toLowerCase(), 'muted'];
  return `<span class="badge badge-${tone}">${esc(labelOverride || label)}</span>`;
}
export const statusLabel = (s) => (STATUS[s] || [String(s).replace(/_/g, ' ')])[0];

// ───── Toasts ─────
function stack() {
  let s = $('.toast-stack');
  if (!s) { s = document.createElement('div'); s.className = 'toast-stack'; s.setAttribute('role', 'status'); s.setAttribute('aria-live', 'polite'); document.body.appendChild(s); }
  return s;
}
export function toast(message, type = 'info', ms = 4500) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `${icon(type === 'success' ? 'checkCircle' : type === 'error' ? 'alert' : 'info')}<div>${esc(message)}</div><button aria-label="Dismiss">×</button>`;
  const close = () => { el.classList.add('leaving'); setTimeout(() => el.remove(), 250); };
  el.querySelector('button').addEventListener('click', close);
  stack().appendChild(el);
  setTimeout(close, ms);
}
export const toastError = (err) => toast(err?.message || 'Something went wrong.', 'error', 6000);

// ───── Modals ─────
/**
 * Open a modal. `body` is an HTML string or Node. `actions`: [{label, cls, onClick(close, modalEl) | 'close', type}]
 * Returns { el, close }.
 */
export function modal({ title, body, actions = [], wide = false, onClose } = {}) {
  const prevFocus = document.activeElement;
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div class="modal-head"><h2 id="modal-title">${esc(title)}</h2><button class="modal-close" aria-label="Close">${icon('x')}</button></div>
      <div class="modal-body"></div>
      ${actions.length ? '<div class="modal-foot"></div>' : ''}
    </div>`;
  const m = backdrop.querySelector('.modal');
  const bodyEl = m.querySelector('.modal-body');
  if (typeof body === 'string') bodyEl.innerHTML = body; else if (body) bodyEl.appendChild(body);
  const close = (result) => {
    backdrop.remove();
    if (!$('.modal-backdrop')) document.body.classList.remove('no-scroll');
    document.removeEventListener('keydown', onKey);
    prevFocus?.focus?.();
    onClose?.(result);
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  actions.forEach((a) => {
    const b = document.createElement('button');
    b.type = a.type || 'button';
    b.className = `btn ${a.cls || 'btn-outline'}`;
    b.textContent = a.label;
    if (a.form) b.setAttribute('form', a.form);
    b.addEventListener('click', (e) => (a.onClick === 'close' || !a.onClick ? close() : a.onClick(close, m, b, e)));
    m.querySelector('.modal-foot').appendChild(b);
  });
  m.querySelector('.modal-close').addEventListener('click', () => close());
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(backdrop);
  document.body.classList.add('no-scroll');
  setTimeout(() => (m.querySelector('input:not([type=hidden]), select, textarea') || m.querySelector('.modal-foot .btn:last-child') || m).focus?.(), 30);
  return { el: m, close };
}

/** Promise-based confirmation. With `input`, resolves to the entered text (or null on cancel). */
export function confirmDialog({ title = 'Are you sure?', message = '', confirmText = 'Confirm', danger = false, input = null } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const inputHtml = input ? `<div class="field mt-2"><label for="cd-input">${esc(input.label)}</label>${input.multiline ? `<textarea id="cd-input" class="textarea" ${input.required ? 'required' : ''} maxlength="${input.max || 1000}" placeholder="${esc(input.placeholder || '')}"></textarea>` : `<input id="cd-input" class="input" ${input.required ? 'required' : ''} placeholder="${esc(input.placeholder || '')}">`}<div class="field-error"></div></div>` : '';
    const { el } = modal({
      title,
      body: `<p class="mb-0">${message}</p>${inputHtml}`,
      onClose: () => { if (!done) resolve(input ? null : false); },
      actions: [
        { label: 'Cancel', cls: 'btn-outline' },
        {
          label: confirmText, cls: danger ? 'btn-danger' : 'btn',
          onClick: (close) => {
            if (input) {
              const v = el.querySelector('#cd-input').value.trim();
              if (input.required && v.length < (input.min || 1)) { el.querySelector('.field-error').textContent = `Please enter at least ${input.min || 1} characters.`; el.querySelector('.field').classList.add('has-error'); return; }
              done = true; close(); resolve(v);
            } else { done = true; close(); resolve(true); }
          },
        },
      ],
    });
  });
}

// ───── States ─────
export const loadingState = (text = 'Loading…') => `<div class="state"><div class="spinner"></div><p>${esc(text)}</p></div>`;
export function emptyState({ icon: ic = 'search', title = 'Nothing here yet', text = '', action = '' } = {}) {
  return `<div class="state">${icon(ic)}<h3>${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ''}${action}</div>`;
}
export function errorState(err, { retry = true } = {}) {
  return `<div class="state state-error">${icon('alert')}<h3>We couldn't load this</h3><p>${esc(err?.message || 'Unexpected error.')}</p>${retry ? '<button class="btn btn-outline btn-sm" data-retry>Try again</button>' : ''}</div>`;
}
/** Render async content into a container with loading → success/empty/error states and a retry button. */
export async function loadInto(container, loader, { loadingText } = {}) {
  container.innerHTML = loadingState(loadingText);
  try {
    await loader();
  } catch (err) {
    container.innerHTML = errorState(err);
    container.querySelector('[data-retry]')?.addEventListener('click', () => loadInto(container, loader, { loadingText }));
    if (err.status === 401) location.href = `/login.html?next=${encodeURIComponent(location.pathname + location.search)}`;
  }
}

// ───── Buttons & forms ─────
export async function withLoading(btn, fn) {
  if (!btn) return fn();
  const prev = btn.innerHTML;
  btn.classList.add('is-loading');
  btn.disabled = true;
  try { return await fn(); } finally { btn.classList.remove('is-loading'); btn.disabled = false; btn.innerHTML = prev; }
}

export function clearErrors(form) {
  $$('.field.has-error', form).forEach((f) => f.classList.remove('has-error'));
  $$('.field-error', form).forEach((e) => { e.textContent = ''; });
  $('.form-alert', form)?.remove();
}

function fieldFor(form, name) {
  const input = form.querySelector(`[name="${CSS.escape(name)}"]`);
  return input?.closest('.field');
}
export function setFieldError(form, name, message) {
  const f = fieldFor(form, name);
  if (!f) return false;
  f.classList.add('has-error');
  let e = f.querySelector('.field-error');
  if (!e) { e = document.createElement('div'); e.className = 'field-error'; f.appendChild(e); }
  e.textContent = message;
  return true;
}

/** Show API validation errors next to fields, plus a top-level alert for anything else. */
export function showErrors(form, err) {
  clearErrors(form);
  let placed = false;
  for (const [k, msg] of Object.entries(err.fields || {})) placed = setFieldError(form, k.split('.').pop(), msg) || placed;
  if (!placed || !Object.keys(err.fields || {}).length) {
    const a = document.createElement('div');
    a.className = 'alert alert-danger form-alert mb-2';
    a.setAttribute('role', 'alert');
    a.innerHTML = `${icon('alert')}<div>${esc(err.message)}</div>`;
    form.prepend(a);
  }
  form.querySelector('.has-error .input, .has-error .select, .has-error .textarea')?.focus();
}

const MESSAGES = {
  valueMissing: 'This field is required.',
  typeMismatch: { email: 'Enter a valid email address.', url: 'Enter a valid URL (https://…).', default: 'Invalid value.' },
  tooShort: (el) => `Must be at least ${el.minLength} characters.`,
  tooLong: (el) => `Must be at most ${el.maxLength} characters.`,
  rangeUnderflow: (el) => `Must be at least ${el.min}.`,
  rangeOverflow: (el) => `Must be at most ${el.max}.`,
  stepMismatch: () => 'Please enter a valid amount.',
  patternMismatch: (el) => el.dataset.patternMsg || 'Invalid format.',
};
/** Client-side validation using HTML constraints + optional custom checks. Returns true when valid. */
export function validateForm(form, custom = {}) {
  clearErrors(form);
  let firstBad = null;
  for (const el of form.elements) {
    if (!el.name || el.disabled || el.type === 'hidden') continue;
    let msg = '';
    if (!el.checkValidity()) {
      const v = el.validity;
      const key = Object.keys(MESSAGES).find((k) => v[k]);
      const m = MESSAGES[key];
      msg = typeof m === 'function' ? m(el) : typeof m === 'object' ? (m[el.type] || m.default) : m || el.validationMessage;
      if (el.dataset.requiredMsg && v.valueMissing) msg = el.dataset.requiredMsg;
    }
    if (!msg && custom[el.name]) msg = custom[el.name](el.value, form) || '';
    if (msg) { setFieldError(form, el.name, msg); firstBad = firstBad || el; }
  }
  firstBad?.focus();
  return !firstBad;
}

// Clear a field's error as soon as the user edits it.
const clearOnEdit = (e) => {
  const f = e.target.closest?.('.field.has-error');
  if (!f) return;
  f.classList.remove('has-error');
  const msg = f.querySelector('.field-error');
  if (msg) msg.textContent = '';
};
document.addEventListener('input', clearOnEdit);
document.addEventListener('change', clearOnEdit);

/** Form → plain object. `data-type="number"|"bool"|"array"` controls coercion. */
export function formValues(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled || el.type === 'submit' || el.type === 'button') continue;
    const t = el.dataset.type;
    if (el.type === 'checkbox') {
      if (t === 'array') { out[el.name] = out[el.name] || []; if (el.checked) out[el.name].push(Number.isNaN(Number(el.value)) ? el.value : Number(el.value)); }
      else out[el.name] = el.checked;
      continue;
    }
    if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; continue; }
    let v = el.value.trim?.() ?? el.value;
    if (t === 'number') v = v === '' ? null : Number(v);
    out[el.name] = v;
  }
  return out;
}

export function fillForm(form, values) {
  for (const el of form.elements) {
    if (!el.name || !(el.name in values)) continue;
    const v = values[el.name];
    if (el.type === 'checkbox') el.checked = el.dataset.type === 'array' ? (v || []).map(String).includes(el.value) : Boolean(v);
    else if (el.type === 'radio') el.checked = String(v) === el.value;
    else el.value = v ?? '';
  }
}

/** Password show/hide buttons + strength meter. */
export function initPasswordFields(root = document) {
  $$('[data-password]', root).forEach((input) => {
    if (input.parentElement.classList.contains('password-wrap')) return;
    const wrap = document.createElement('div');
    wrap.className = 'password-wrap';
    input.replaceWith(wrap);
    wrap.appendChild(input);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'password-toggle';
    b.setAttribute('aria-label', 'Show password');
    b.innerHTML = icon('eye');
    b.addEventListener('click', () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      b.innerHTML = icon(show ? 'eyeOff' : 'eye');
      b.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    });
    wrap.appendChild(b);
    if (input.dataset.meter !== undefined) {
      const meter = document.createElement('div');
      meter.className = 'pw-meter mt-1';
      meter.innerHTML = '<span></span>';
      wrap.after(meter);
      input.addEventListener('input', () => {
        const v = input.value;
        const score = [v.length >= 8, /[a-z]/i.test(v) && /\d/.test(v), /[^a-z0-9]/i.test(v), v.length >= 12].filter(Boolean).length;
        const bar = meter.firstChild;
        bar.style.width = `${(score / 4) * 100}%`;
        bar.style.background = ['#B3403A', '#B3403A', '#9A6A12', '#2F7D5B', '#2F7D5B'][score];
      });
    }
  });
}

export const PASSWORD_RULE = (v) => (v.length < 8 ? 'Password must be at least 8 characters.' : !/[a-z]/i.test(v) || !/\d/.test(v) ? 'Use at least one letter and one number.' : '');

/** Reveal-on-scroll for marketing sections. */
export function initReveal() {
  const els = $$('.reveal');
  if (!('IntersectionObserver' in window)) { els.forEach((e) => e.classList.add('in')); return; }
  const io = new IntersectionObserver((entries) => entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } }), { threshold: 0.12 });
  els.forEach((e) => io.observe(e));
}

/** Fallback when a remote image fails to load. */
export function imgFallback(root = document) {
  $$('img[data-fallback]', root).forEach((img) => {
    img.addEventListener('error', () => { img.style.visibility = 'hidden'; img.parentElement?.classList.add('skeleton'); }, { once: true });
  });
}

export { icon };
