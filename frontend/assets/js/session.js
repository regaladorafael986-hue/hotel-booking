// Current-user session helpers and page guards.
import { api, setCsrf } from './api.js';

let current;
export async function getUser({ refresh = false } = {}) {
  if (current !== undefined && !refresh) return current;
  try {
    const r = await api.get('/auth/me');
    current = r.user;
  } catch (e) {
    if (e.status !== 401) throw e;
    current = null;
  }
  return current;
}
export const setUser = (u) => { current = u; };

export const homeFor = (u) => (u?.role === 'ADMIN' ? '/admin/dashboard.html' : u?.role === 'RECEPTIONIST' ? '/staff/dashboard.html' : '/customer/dashboard.html');

/** Redirect to login (or the user's own area) unless the user has one of `roles`. */
export async function requireRole(...roles) {
  const u = await getUser();
  if (!u) {
    location.replace(`/login.html?next=${encodeURIComponent(location.pathname + location.search)}`);
    return new Promise(() => {});
  }
  if (roles.length && !roles.includes(u.role)) {
    location.replace(homeFor(u));
    return new Promise(() => {});
  }
  return u;
}

export async function logout() {
  try { await api.post('/auth/logout'); } catch { /* ignore */ }
  current = null;
  setCsrf(null);
  location.href = '/';
}

export const can = (user, perm) => user?.role === 'ADMIN' || (user?.permissions || []).includes(perm);
