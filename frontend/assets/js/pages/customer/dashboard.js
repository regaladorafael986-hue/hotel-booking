import { api } from '../../api.js';
import { $, esc, icon, money, ago, loadInto, emptyState, toast, withLoading, imgFallback, dateTime } from '../../ui.js';
import { initDashboard } from '/components/dashboard-shell.js';
import { bookingTile, flash } from './common.js';

const app = $('#app');
const user = await initDashboard({ area: 'CUSTOMER', active: 'dashboard', title: 'My account' });

loadInto(app, async () => {
  const [up, current, done, all, notes] = await Promise.all([
    api.get('/bookings/my', { status: 'upcoming', page_size: 5 }),
    api.get('/bookings/my', { status: 'current', page_size: 5 }),
    api.get('/bookings/my', { status: 'completed', page_size: 5 }),
    api.get('/bookings/my', { page_size: 100 }),
    api.get('/notifications', { page_size: 5 }),
  ]);
  const spent = all.items.reduce((s, b) => s + (b.amount_paid - b.amount_refunded), 0);
  const payments = all.items.flatMap((b) => (b.payments || []).filter((p) => p.payment_status !== 'PENDING').map((p) => ({ ...p, ref: b.booking_reference, bid: b.id }))).sort((a, b) => new Date(b.paid_at || b.created_at) - new Date(a.paid_at || a.created_at)).slice(0, 5);
  const msg = flash();

  app.innerHTML = `
    ${msg ? `<div class="alert alert-success mb-3">${icon('checkCircle')}<div>${esc(msg)}</div></div>` : ''}
    ${user.email_verified ? '' : `<div class="alert alert-warning mb-3">${icon('mail')}<div><strong>Verify your email to start booking.</strong> We sent a link to ${esc(user.email)}. <button class="link-btn" id="resend">Resend verification email</button></div></div>`}
    <div class="welcome-card"><div><h1>Hello, ${esc(user.first_name)}</h1><p>${up.items.length ? `Your next stay begins ${new Date(`${up.items[up.items.length - 1].check_in}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })}.` : 'Ready for your next getaway?'}</p></div><a class="btn btn-gold" href="/rooms.html">${icon('calendar')} Book a stay</a></div>
    <div class="stats">
      <a class="stat" href="/customer/my-bookings.html?tab=upcoming"><div class="lbl">Upcoming ${icon('calendar')}</div><div class="val">${up.pagination.total}</div><div class="sub">reservations</div></a>
      <a class="stat" href="/customer/my-bookings.html?tab=current"><div class="lbl">Current stay ${icon('door')}</div><div class="val">${current.pagination.total}</div><div class="sub">checked in</div></a>
      <a class="stat" href="/customer/my-bookings.html?tab=completed"><div class="lbl">Completed ${icon('checkCircle')}</div><div class="val">${done.pagination.total}</div><div class="sub">stays</div></a>
      <div class="stat accent"><div class="lbl">Total spent ${icon('card')}</div><div class="val">${money(spent)}</div><div class="sub">net of refunds</div></div>
    </div>
    <div class="dash-grid">
      <section class="card span-8"><div class="card-head"><h2>Upcoming &amp; current stays</h2><a class="small" href="/customer/my-bookings.html">View all</a></div>
        ${[...current.items, ...up.items].length ? [...current.items, ...up.items].map(bookingTile).join('') : emptyState({ icon: 'calendar', title: 'No upcoming stays', text: 'When you book, your reservations will appear here.', action: '<a class="btn" href="/rooms.html">Find a room</a>' })}
      </section>
      <div class="span-4 stack" style="--stack:20px">
        <section class="card"><div class="card-head"><h2>Notifications</h2><a class="small" href="/customer/notifications.html">All</a></div>
          ${notes.items.length ? `<ul class="list-plain">${notes.items.map((n) => `<li style="display:block"><strong class="small">${esc(n.title)}</strong><div class="small muted">${esc(n.message)}</div><div class="small muted">${ago(n.created_at)}</div></li>`).join('')}</ul>` : emptyState({ icon: 'bell', title: 'No notifications' })}
        </section>
        <section class="card"><div class="card-head"><h2>Payment history</h2></div>
          ${payments.length ? `<ul class="list-plain">${payments.map((p) => `<li><div><a href="/customer/booking-details.html?id=${p.bid}" class="small"><strong>${esc(p.ref)}</strong></a><div class="small muted">${dateTime(p.paid_at || p.created_at)} · ${esc(p.payment_method || p.provider)}</div></div><div class="text-right"><strong class="small">${money(p.amount)}</strong><div class="small muted">${esc(p.payment_status.replace('_', ' ').toLowerCase())}</div></div></li>`).join('')}</ul>` : emptyState({ icon: 'card', title: 'No payments yet' })}
        </section>
      </div>
    </div>`;
  imgFallback(app);
  $('#resend')?.addEventListener('click', async (e) => {
    await withLoading(e.currentTarget, async () => {
      try { await api.post('/auth/resend-verification'); toast('Verification email sent. Check your inbox.', 'success'); } catch (err) { toast(err.message, 'error'); }
    });
  });
});
