// Dashboard layout (collapsible sidebar + top bar + notifications) for admin, receptionist and customer areas.
import { api } from '/assets/js/api.js';
import { requireRole, logout, can } from '/assets/js/session.js';
import { $, $$, esc, icon, initials, ago, toastError } from '/assets/js/ui.js';
import { brandHtml } from './site-shell.js';

const MENUS = {
  ADMIN: {
    label: 'Administrator',
    groups: [
      ['Overview', [['dashboard', 'Dashboard', '/admin/dashboard.html', 'grid'], ['reports', 'Reports', '/admin/reports.html', 'chart']]],
      ['Reservations', [['bookings', 'Reservations', '/admin/bookings.html', 'calendar', 'pending'], ['payments', 'Payments & refunds', '/admin/payments.html', 'card'], ['frontdesk', 'Front desk', '/staff/dashboard.html', 'door']]],
      ['Hotel', [['room-types', 'Room categories', '/admin/room-types.html', 'bed'], ['rooms', 'Physical rooms', '/admin/rooms.html', 'door'], ['amenities', 'Amenities', '/admin/amenities.html', 'sparkle'], ['settings', 'Hotel settings', '/admin/settings.html', 'settings']]],
      ['People', [['customers', 'Customers', '/admin/customers.html', 'users'], ['staff', 'Staff accounts', '/admin/staff.html', 'key'], ['reviews', 'Reviews', '/admin/reviews.html', 'star']]],
      ['Marketing & system', [['coupons', 'Promotions', '/admin/coupons.html', 'tag'], ['audit', 'Activity log', '/admin/audit-logs.html', 'log']]],
    ],
  },
  RECEPTIONIST: {
    label: 'Front desk',
    groups: [
      ['Today', [['dashboard', 'Front desk', '/staff/dashboard.html', 'grid'], ['arrivals', 'Arrivals', '/staff/arrivals.html', 'arrowRight'], ['departures', 'Departures', '/staff/departures.html', 'logout']]],
      ['Operations', [['bookings', 'Find reservation', '/staff/bookings.html', 'search'], ['walk-in', 'Walk-in booking', '/staff/walk-in.html', 'walk', null, 'walk_in'], ['room-status', 'Room status', '/staff/room-status.html', 'broom']]],
    ],
  },
  CUSTOMER: {
    label: 'My account',
    groups: [
      ['', [['dashboard', 'Overview', '/customer/dashboard.html', 'grid'], ['bookings', 'My bookings', '/customer/my-bookings.html', 'calendar'], ['reviews', 'My reviews', '/customer/reviews.html', 'star'], ['notifications', 'Notifications', '/customer/notifications.html', 'bell'], ['profile', 'Profile & security', '/customer/profile.html', 'user']]],
      ['StayEase', [['book', 'Book a stay', '/rooms.html', 'bed'], ['home', 'Hotel website', '/index.html', 'home']]],
    ],
  },
};

function sidebar(user, area, active) {
  const menu = MENUS[area];
  const groups = menu.groups.map(([label, items]) => {
    const links = items
      .filter(([, , , , , perm]) => !perm || can(user, perm))
      .map(([key, text, href, ic, pillKey]) => `<a href="${href}" class="${key === active ? 'active' : ''}" ${key === active ? 'aria-current="page"' : ''} title="${esc(text)}">${icon(ic)}<span class="nav-text">${esc(text)}</span>${pillKey ? `<span class="pill hidden" data-pill="${pillKey}"></span>` : ''}</a>`)
      .join('');
    return `${label ? `<div class="group-label">${esc(label)}</div>` : ''}${links}`;
  }).join('');
  const extra = area === 'RECEPTIONIST' && user.role === 'ADMIN' ? `<a href="/admin/dashboard.html">${icon('arrowRight')}<span class="nav-text">Back to admin</span></a>` : '';
  return `<a class="brand" href="${area === 'CUSTOMER' ? '/index.html' : '#'}">${brandHtml()}</a>
    <div class="role-tag">${esc(menu.label)}</div>
    <nav class="side-nav" aria-label="Dashboard">${groups}</nav>
    <div class="side-foot">${extra}<a href="#" data-logout>${icon('logout')}<span class="nav-text">Log out</span></a></div>`;
}

function topbar(user, title) {
  return `<button class="icon-btn" data-toggle-sidebar aria-label="Toggle navigation">${icon('menu')}</button>
    <div class="crumb">${esc(title)}</div>
    <div class="spacer"></div>
    <div style="position:relative">
      <button class="icon-btn" data-notif aria-label="Notifications" aria-haspopup="true">${icon('bell')}<span class="dot hidden"></span></button>
      <div class="notif-panel" role="dialog" aria-label="Notifications">
        <header><strong>Notifications</strong><button class="link-btn small" data-read-all>Mark all read</button></header>
        <div class="notif-list"><div class="state small">Loading…</div></div>
        ${user.role === 'CUSTOMER' ? '<div style="padding:10px 16px;text-align:center"><a class="small" href="/customer/notifications.html">View all</a></div>' : ''}
      </div>
    </div>
    <div class="row" style="gap:10px"><span class="avatar">${esc(initials(user.first_name, user.last_name))}</span><span class="small" style="line-height:1.2"><strong>${esc(user.first_name)}</strong><br><span class="muted">${esc(user.role === 'RECEPTIONIST' ? 'Receptionist' : user.role === 'ADMIN' ? 'Administrator' : 'Guest')}</span></span></div>`;
}

async function loadNotifications(root) {
  const list = $('.notif-list', root);
  const dot = $('[data-notif] .dot', root);
  try {
    const r = await api.get('/notifications', { page_size: 8 });
    dot.textContent = r.unread > 9 ? '9+' : r.unread;
    dot.classList.toggle('hidden', !r.unread);
    list.innerHTML = r.items.length
      ? r.items.map((n) => `<button class="notif-item ${n.is_read ? '' : 'unread'}" data-id="${n.id}" data-booking="${n.booking_id || ''}"><strong>${esc(n.title)}</strong><div>${esc(n.message)}</div><time>${ago(n.created_at)}</time></button>`).join('')
      : '<div class="state small"><p>You are all caught up.</p></div>';
  } catch {
    list.innerHTML = '<div class="state small"><p>Could not load notifications.</p></div>';
  }
}

/**
 * Render the shell and guard the page.
 * @param {{ area: 'ADMIN'|'RECEPTIONIST'|'CUSTOMER', active: string, title: string, roles?: string[] }} opts
 */
export async function initDashboard({ area, active, title, roles }) {
  const user = await requireRole(...(roles || (area === 'RECEPTIONIST' ? ['RECEPTIONIST', 'ADMIN'] : [area])));
  document.body.classList.add('dash');
  try { if (localStorage.getItem('se.sidebar') === 'collapsed') document.body.classList.add('sidebar-collapsed'); } catch { /* ignore */ }

  const side = document.createElement('aside');
  side.className = 'dash-sidebar';
  side.innerHTML = sidebar(user, area, active);
  const backdrop = document.createElement('div');
  backdrop.className = 'sidebar-backdrop';
  document.body.prepend(backdrop);
  document.body.prepend(side);

  const main = $('.dash-main');
  const bar = document.createElement('header');
  bar.className = 'dash-topbar';
  bar.innerHTML = topbar(user, title);
  main.prepend(bar);

  $('[data-toggle-sidebar]', bar).addEventListener('click', () => {
    if (window.matchMedia('(max-width: 1024px)').matches) document.body.classList.toggle('sidebar-open');
    else {
      const c = document.body.classList.toggle('sidebar-collapsed');
      try { localStorage.setItem('se.sidebar', c ? 'collapsed' : 'open'); } catch { /* ignore */ }
    }
  });
  backdrop.addEventListener('click', () => document.body.classList.remove('sidebar-open'));
  $$('[data-logout]', side).forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); logout(); }));

  const panel = $('.notif-panel', bar);
  $('[data-notif]', bar).addEventListener('click', (e) => {
    e.stopPropagation();
    if (panel.classList.toggle('open')) loadNotifications(bar);
  });
  panel.addEventListener('click', async (e) => {
    e.stopPropagation();
    const item = e.target.closest('.notif-item');
    if (item) {
      api.post(`/notifications/${item.dataset.id}/read`).catch(() => {});
      if (item.dataset.booking) {
        location.href = user.role === 'CUSTOMER' ? `/customer/booking-details.html?id=${item.dataset.booking}` : user.role === 'ADMIN' ? `/admin/booking-details.html?id=${item.dataset.booking}` : `/staff/booking.html?id=${item.dataset.booking}`;
      } else loadNotifications(bar);
    }
    if (e.target.closest('[data-read-all]')) {
      try { await api.post('/notifications/read-all'); loadNotifications(bar); } catch (err) { toastError(err); }
    }
  });
  document.addEventListener('click', () => panel.classList.remove('open'));
  loadNotifications(bar);
  document.title = `${title} · StayEase`;
  return user;
}

/** Set the small counter pill next to a sidebar item. */
export function setPill(key, n) {
  const p = $(`[data-pill="${key}"]`);
  if (!p) return;
  p.textContent = n;
  p.classList.toggle('hidden', !n);
}
