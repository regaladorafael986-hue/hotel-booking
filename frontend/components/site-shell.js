// Public website header + footer, shared by every customer-facing page.
import { api } from '/assets/js/api.js';
import { getUser, logout, homeFor } from '/assets/js/session.js';
import { $, esc, icon, initials, imgFallback, initReveal } from '/assets/js/ui.js';

const NAV = [
  ['Home', '/index.html', ['/', '/index.html']],
  ['Rooms', '/rooms.html', ['/rooms.html', '/room-details.html']],
  ['About', '/about.html', ['/about.html']],
  ['Contact', '/contact.html', ['/contact.html']],
];

let hotelPromise;
/** Public hotel profile (cached for the session for 5 minutes). */
export function getHotel() {
  if (!hotelPromise) {
    hotelPromise = (async () => {
      try {
        const cached = JSON.parse(sessionStorage.getItem('se.hotel') || 'null');
        if (cached && Date.now() - cached.t < 300000) return cached.v;
      } catch { /* ignore */ }
      const v = await api.get('/hotel');
      try { sessionStorage.setItem('se.hotel', JSON.stringify({ t: Date.now(), v })); } catch { /* ignore */ }
      return v;
    })();
  }
  return hotelPromise;
}

export const brandHtml = (name = 'StayEase') => `<span class="brand-mark" aria-hidden="true">S</span><span class="brand-name">${esc(name.split(' ')[0])}<small>Hotel &amp; Suites</small></span>`;

function header(user) {
  const path = location.pathname;
  const links = NAV.map(([label, href, match]) => `<a class="nav-link ${match.includes(path) ? 'active' : ''}" href="${href}">${label}</a>`).join('');
  const account = user
    ? `<div class="user-menu">
         <button class="user-menu-btn" aria-haspopup="true" aria-expanded="false"><span class="avatar">${esc(initials(user.first_name, user.last_name))}</span><span class="btn-text">${esc(user.first_name)}</span>${icon('chevronDown')}</button>
         <div class="dropdown" role="menu">
           <div class="dd-head"><strong>${esc(user.first_name)} ${esc(user.last_name)}</strong><div class="muted small">${esc(user.email)}</div></div>
           <a href="${homeFor(user)}" role="menuitem">${icon('grid')} ${user.role === 'CUSTOMER' ? 'My dashboard' : 'Open dashboard'}</a>
           ${user.role === 'CUSTOMER' ? `<a href="/customer/my-bookings.html" role="menuitem">${icon('calendar')} My bookings</a><a href="/customer/profile.html" role="menuitem">${icon('user')} Profile</a>` : ''}
           <button data-logout role="menuitem">${icon('logout')} Log out</button>
         </div>
       </div>`
    : `<span class="auth-links row"><a class="btn btn-ghost" href="/login.html">Log in</a><a class="btn btn-outline" href="/register.html">Register</a></span>`;
  return `<div class="container bar">
      <a class="brand" href="/index.html" aria-label="StayEase home">${brandHtml()}</a>
      <nav class="nav" id="site-nav" aria-label="Main">${links}</nav>
      <div class="nav-actions">
        ${account}
        <a class="btn btn-gold" href="/rooms.html">${icon('calendar')}<span class="btn-text">Book now</span></a>
        <button class="nav-toggle" aria-label="Open menu" aria-expanded="false" aria-controls="site-nav">${icon('menu')}</button>
      </div>
    </div>`;
}

function footer(h) {
  return `<div class="container">
      <div class="cols">
        <div>
          <a class="brand" href="/index.html">${brandHtml(h?.hotel_name)}</a>
          <p>${esc(h?.tagline || 'A calm, considered place to stay.')}</p>
          <div class="socials">
            ${h?.facebook_url ? `<a href="${esc(h.facebook_url)}" target="_blank" rel="noopener" aria-label="Facebook">${icon('facebook')}</a>` : ''}
            ${h?.instagram_url ? `<a href="${esc(h.instagram_url)}" target="_blank" rel="noopener" aria-label="Instagram">${icon('instagram')}</a>` : ''}
          </div>
        </div>
        <div><h4>Explore</h4><ul><li><a href="/rooms.html">Rooms &amp; suites</a></li><li><a href="/about.html">About the hotel</a></li><li><a href="/index.html#offers">Special offers</a></li><li><a href="/contact.html">Contact &amp; location</a></li></ul></div>
        <div><h4>Guests</h4><ul><li><a href="/customer/my-bookings.html">Manage booking</a></li><li><a href="/policies.html">Hotel policies</a></li><li><a href="/policies.html#cancellation">Cancellation policy</a></li><li><a href="/login.html">Staff login</a></li></ul></div>
        <div><h4>Contact</h4><ul>
          ${h?.address ? `<li>${esc(h.address)}</li>` : ''}
          ${h?.contact_number ? `<li><a href="tel:${esc(h.contact_number.replace(/\s/g, ''))}">${esc(h.contact_number)}</a></li>` : ''}
          ${h?.email ? `<li><a href="mailto:${esc(h.email)}">${esc(h.email)}</a></li>` : ''}
          <li>Check-in ${esc(h?.check_in_time || '14:00')} · Check-out ${esc(h?.check_out_time || '12:00')}</li>
        </ul></div>
      </div>
      <div class="bottom"><span>© ${new Date().getFullYear()} ${esc(h?.hotel_name || 'StayEase')}. All rights reserved.</span><span><a href="/policies.html">Policies</a> · <a href="/policies.html#privacy">Privacy</a></span></div>
    </div>`;
}

/** Render header/footer. Returns { user, hotel }. */
export async function initSite() {
  document.body.classList.add('site');
  const headerEl = $('#site-header');
  const footerEl = $('#site-footer');
  const [user, hotel] = await Promise.all([getUser().catch(() => null), getHotel().catch(() => null)]);
  if (headerEl) {
    headerEl.className = 'site-header';
    headerEl.innerHTML = header(user);
    const nav = $('#site-nav');
    const toggle = $('.nav-toggle', headerEl);
    toggle.addEventListener('click', () => {
      const open = nav.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(open));
      toggle.innerHTML = icon(open ? 'x' : 'menu');
    });
    const menuBtn = $('.user-menu-btn', headerEl);
    if (menuBtn) {
      const dd = $('.dropdown', headerEl);
      menuBtn.addEventListener('click', (e) => { e.stopPropagation(); const o = dd.classList.toggle('open'); menuBtn.setAttribute('aria-expanded', String(o)); });
      document.addEventListener('click', () => dd.classList.remove('open'));
      $('[data-logout]', headerEl).addEventListener('click', logout);
    }
  }
  if (footerEl) { footerEl.className = 'site-footer'; footerEl.innerHTML = footer(hotel); }
  if (hotel?.hotel_name) document.title = document.title.replace('StayEase', hotel.hotel_name.split(' ')[0]);
  imgFallback();
  initReveal();
  return { user, hotel };
}
