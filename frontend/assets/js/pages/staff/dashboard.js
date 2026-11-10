import { api } from '../../api.js';
import { $, esc, icon, date, loadInto, emptyState, withLoading, toast, num } from '../../ui.js';
import { initDashboard } from '/components/dashboard-shell.js';
import { can } from '../../session.js';
import { deskCard, bindDeskActions, bookingHref } from './common.js';

const app = $('#app');
const user = await initDashboard({ area: 'RECEPTIONIST', active: 'dashboard', title: 'Front desk' });

async function load() {
  await loadInto(app, async () => {
    const d = await api.get('/staff/dashboard');
    const s = d.stats;
    const hk = s.housekeeping;
    app.innerHTML = `
      <div class="page-head"><div><h1>Front desk</h1><p>${date(d.date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</p></div>
        <div class="actions">${can(user, 'walk_in') ? `<a class="btn btn-gold" href="/staff/walk-in.html">${icon('walk')} Walk-in booking</a>` : ''}<button class="btn btn-outline" id="refresh">${icon('refresh')} Refresh</button></div></div>
      <section class="card mb-3"><div class="card-body">
        <form id="lookup" class="lookup" novalidate><label for="ref" class="sr-only">Booking reference</label><input id="ref" class="input" name="ref" placeholder="Enter booking reference, e.g. SE-ABCD1234" required pattern="[A-Za-z]{2}-[A-Za-z0-9]{8}" data-pattern-msg="Format: SE-XXXXXXXX" autocomplete="off"><button class="btn btn-lg" type="submit">${icon('search')} Verify</button></form>
        <div class="field-error mt-1" id="lookup-err" role="alert"></div>
        <p class="small muted mt-1 mb-0">Or <a href="/staff/bookings.html">search by guest name, email or phone</a>.</p>
      </div></section>
      <div class="stats">
        <a class="stat" href="/staff/arrivals.html"><div class="lbl">Arrivals today ${icon('arrowRight')}</div><div class="val">${s.arrivals_pending}<span style="font-size:1rem;color:var(--muted)"> / ${s.arrivals}</span></div><div class="sub">still to check in</div></a>
        <a class="stat" href="/staff/departures.html"><div class="lbl">Departures today ${icon('logout')}</div><div class="val">${s.departures_pending}<span style="font-size:1rem;color:var(--muted)"> / ${s.departures}</span></div><div class="sub">still to check out</div></a>
        <div class="stat accent"><div class="lbl">In-house ${icon('users')}</div><div class="val">${s.occupied_rooms} rooms</div><div class="sub">${s.occupancy_rate}% occupancy · ${num(s.in_house)} stays</div></div>
        <div class="stat"><div class="lbl">Available tonight ${icon('bed')}</div><div class="val">${s.available_rooms}</div><div class="sub">of ${s.physical_rooms} active rooms</div></div>
        <a class="stat" href="/staff/room-status.html"><div class="lbl">Housekeeping ${icon('broom')}</div><div class="val">${hk.DIRTY || 0} dirty</div><div class="sub">${hk.CLEANING || 0} cleaning · ${hk.MAINTENANCE || 0} maintenance</div></a>
      </div>
      <div class="dash-grid">
        <section class="card span-6"><div class="card-head"><h2>Today's arrivals</h2><a class="small" href="/staff/arrivals.html">All arrivals</a></div><div data-list>${d.arrivals.length ? d.arrivals.map((b) => deskCard(b, user, 'arrival')).join('') : emptyState({ icon: 'arrowRight', title: 'No arrivals today' })}</div></section>
        <section class="card span-6"><div class="card-head"><h2>Today's departures</h2><a class="small" href="/staff/departures.html">All departures</a></div><div data-list>${d.departures.length ? d.departures.map((b) => deskCard(b, user, 'departure')).join('') : emptyState({ icon: 'logout', title: 'No departures today' })}</div></section>
        <section class="card span-6"><div class="card-head"><h2>In-house guests</h2><span class="small muted">${d.in_house.length} stays</span></div><div>${d.in_house.length ? d.in_house.slice(0, 8).map((b) => deskCard(b, user, 'view')).join('') : emptyState({ icon: 'users', title: 'No guests in house' })}</div></section>
        <section class="card span-6"><div class="card-head"><h2>Upcoming (next 7 days)</h2></div><div>${d.upcoming.length ? d.upcoming.slice(0, 8).map((b) => deskCard(b, user, 'view')).join('') : emptyState({ icon: 'calendar', title: 'No upcoming arrivals' })}</div></section>
      </div>`;
    $('#refresh').addEventListener('click', load);
    const form = $('#lookup');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('#lookup-err');
      err.textContent = '';
      const ref = form.ref.value.trim().toUpperCase();
      if (!/^[A-Z]{2}-[A-Z0-9]{8}$/.test(ref)) { err.textContent = 'Enter a reference in the format SE-XXXXXXXX.'; return; }
      await withLoading(form.querySelector('button'), async () => {
        try {
          const { booking } = await api.get(`/staff/bookings/reference/${encodeURIComponent(ref)}`);
          toast(`Found ${booking.booking_reference} — ${booking.guest_first_name} ${booking.guest_last_name}.`, 'success');
          location.href = bookingHref(user, booking.id);
        } catch (e2) { err.textContent = e2.message; }
      });
    });
  });
}

bindDeskActions(app, user, load);
load();
