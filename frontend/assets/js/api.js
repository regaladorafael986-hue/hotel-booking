// Fetch wrapper for the StayEase REST API (same-origin, cookie session + CSRF header).
const BASE = '/api/v1';
let csrfToken = null;
let csrfPromise = null;

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error?.message || `Request failed (${status})`);
    this.status = status;
    this.code = body?.error?.code;
    this.details = body?.error?.details;
    this.fields = body?.error?.details?.fields || {};
  }
}

async function getCsrf(force = false) {
  if (csrfToken && !force) return csrfToken;
  if (!csrfPromise || force) {
    csrfPromise = fetch(`${BASE}/auth/csrf`, { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((d) => { csrfToken = d.csrf_token; return csrfToken; })
      .finally(() => { csrfPromise = null; });
  }
  return csrfPromise;
}
export function setCsrf(token) { if (token) csrfToken = token; }

function toQuery(params) {
  if (!params) return '';
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) { if (v.length) q.set(k, v.join(',')); } else q.set(k, v);
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

async function request(method, path, { body, params, raw, retry = true } = {}) {
  const headers = { Accept: 'application/json' };
  const opts = { method, headers, credentials: 'same-origin' };
  if (method !== 'GET') headers['X-CSRF-Token'] = await getCsrf();
  if (body instanceof FormData) opts.body = body;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }

  let res;
  try {
    res = await fetch(`${BASE}${path}${toQuery(params)}`, opts);
  } catch {
    throw new ApiError(0, { error: { message: 'Cannot reach the server. Check your connection and try again.', code: 'NETWORK' } });
  }
  if (raw && res.ok) return res;
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    // Session may have rotated — refresh the CSRF token once and retry.
    if (res.status === 403 && data?.error?.code === 'CSRF' && retry) {
      await getCsrf(true);
      return request(method, path, { body, params, raw, retry: false });
    }
    throw new ApiError(res.status, data);
  }
  if (data?.csrf_token) setCsrf(data.csrf_token);
  return data;
}

export const api = {
  get: (path, params) => request('GET', path, { params }),
  post: (path, body) => request('POST', path, { body }),
  put: (path, body) => request('PUT', path, { body }),
  del: (path) => request('DELETE', path),
  upload: (path, formData) => request('POST', path, { body: formData }),
  /** Download a binary (PDF/XLSX) and trigger a save dialog. */
  async download(path, params, fallbackName = 'download') {
    const res = await request('GET', path, { params, raw: true });
    const blob = await res.blob();
    const cd = res.headers.get('Content-Disposition') || '';
    const name = /filename="([^"]+)"/.exec(cd)?.[1] || fallbackName;
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  },
  url: (path, params) => `${BASE}${path}${toQuery(params)}`,
};
