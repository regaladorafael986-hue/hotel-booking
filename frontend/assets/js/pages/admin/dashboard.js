import { api } from '../../api.js';
import { $, esc, icon, money, moneyShort, num, date, ago, badge, loadInto, emptyState } from '../../ui.js';
import { initDashboard, setPill } from '/components/dashboard-shell.js';
import { renderChart, tableHtml } from '/components/charts.js';

const app = $('#app');
await initDashboard({ area: 'ADMIN', active: 'dashboard', title: 'Dashboard' });

const shortDay = (l, long) => (l.length === 10 ? date(l, long ? { weekday: 'short', month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric' }) : l.length === 7 ? new Date(`${l}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: long ? 'numeric' : '2-digit', timeZone: 'UTC' }) : l);
const pesoTick = (v, axis) => (axis ? moneyShort(v).replace('.00', '') : money(v));

function stat(label, value, sub, ic, href, accent) {
  const tag = href ? 'a' : 'div';
  return `<${tag} class="stat ${accent ? 'accent' : ''}" ${href ? `href="${href}"` : ''}><div class="lbl">${label} ${icon(ic)}</div><div class="val">${value}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</${tag}>`;
}

function chartCard(id, title, span, extra = '') {
  return `<section class="card ${span}"><div class="card-head"><h2>${title}</h2><div class="row">${extra}<button class="btn btn-ghost btn-sm" data-table="${id}" aria-pressed="false">${icon('log')} Table</button></div></div><div class="chart-box" id="${id}"></div></section>`;
}

let data;
const views = {};
async function drawChart(id, spec) {
  views[id] = spec;
  await renderChart($(`#${id}`), spec);
}

loadInto(app, async () => {
  data = await api.get('/admin/dashboard');
  const s = data.stats;
  const c = data.charts;
  setPill('pending', s.pending_confirmation + s.cancellation_requests);
  app.innerHTML = `
    <div class="page-head"><div><h1>Dashboard</h1><p>Live overview for ${date(s.as_of, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}.</p></div>
      <div class="actions"><a class="btn btn-outline" href="/admin/reports.html">${icon('chart')} Reports</a><a class="btn" href="/staff/dashboard.html">${icon('door')} Front desk</a></div></div>
    ${s.cancellation_requests || s.pending_confirmation ? `<div class="alert alert-warning mb-3">${icon('alert')}<div>${s.cancellation_requests ? `<a href="/admin/bookings.html?cancellation=REQUESTED">${s.cancellation_requests} cancellation request${s.cancellation_requests > 1 ? 's' : ''}</a> awaiting review. ` : ''}${s.pending_confirmation ? `<a href="/admin/bookings.html?status=PENDING_CONFIRMATION">${s.pending_confirmation} reservation${s.pending_confirmation > 1 ? 's' : ''}</a> awaiting confirmation.` : ''}</div></div>` : ''}
    <div class="stats">
      ${stat('Total revenue', money(s.total_revenue), 'collected, net of refunds', 'card', '/admin/payments.html', true)}
      ${stat('Reservations', num(s.total_reservations), 'all time (excl. expired holds)', 'calendar', '/admin/bookings.html')}
      ${stat('Pending', num(s.pending_reservations), `${s.pending_confirmation} to confirm · ${s.pending_payment} awaiting payment`, 'clock', '/admin/bookings.html?status=PENDING_CONFIRMATION')}
      ${stat("Today's check-ins", num(s.todays_check_ins), 'arrivals scheduled', 'arrowRight', '/staff/arrivals.html')}
      ${stat("Today's check-outs", num(s.todays_check_outs), 'departures scheduled', 'logout', '/staff/departures.html')}
      ${stat('Occupied rooms', `${s.occupied_rooms}`, `${s.occupancy_rate}% of ${s.physical_rooms} rooms`, 'users', '/staff/room-status.html')}
      ${stat('Available tonight', num(s.available_rooms), `${s.maintenance_rooms} under maintenance`, 'bed', '/admin/rooms.html')}
      ${stat('Physical rooms', num(s.physical_rooms), `${s.room_categories} categories`, 'door', '/admin/room-types.html')}
      ${stat('Customers', num(s.total_customers), 'registered accounts', 'user', '/admin/customers.html')}
    </div>
    <div class="dash-grid mb-3">
      ${chartCard('ch-revenue', 'Revenue', 'span-8', '<div class="seg" role="group" aria-label="Revenue period"><button class="active" data-rev="daily_revenue">Daily</button><button data-rev="monthly_revenue">Monthly</button><button data-rev="annual_revenue">Annual</button></div>')}
      ${chartCard('ch-occ', 'Room occupancy · last 30 days', 'span-4')}
      ${chartCard('ch-trend', 'Booking trends · last 30 days', 'span-6')}
      ${chartCard('ch-pop', 'Popular room categories · nights sold (12 mo.)', 'span-6')}
      ${chartCard('ch-pay', 'Payment methods · amount collected', 'span-6')}
      <section class="card span-6"><div class="card-head"><h2>Recent cancellations</h2><a class="small" href="/admin/bookings.html?status=CANCELLED">All</a></div>${list(data.recent.cancellations, (b) => `<li><div><a href="/admin/booking-details.html?id=${b.id}"><strong>${esc(b.booking_reference)}</strong></a><div class="small muted">${esc(b.guest_first_name)} ${esc(b.guest_last_name)}</div></div><div class="text-right">${b.cancellation_status === 'REQUESTED' ? badge('REQUESTED', 'Request') : badge(b.booking_status)}<div class="small muted">${ago(b.cancelled_at || b.cancellation_requested_at)}</div></div></li>`, 'No cancellations')}</section>
    </div>
    <div class="dash-grid">
      <section class="card span-6"><div class="card-head"><h2>Recent bookings</h2><a class="small" href="/admin/bookings.html">All reservations</a></div>${list(data.recent.bookings, (b) => `<li><div><a href="/admin/booking-details.html?id=${b.id}"><strong>${esc(b.booking_reference)}</strong></a><div class="small muted">${esc(b.guest_first_name)} ${esc(b.guest_last_name)} · ${date(b.check_in, { month: 'short', day: 'numeric' })} → ${date(b.check_out, { month: 'short', day: 'numeric' })}</div></div><div class="text-right">${badge(b.booking_status)}<div class="small"><strong>${money(b.total_amount)}</strong></div></div></li>`, 'No bookings yet')}</section>
      <section class="card span-6"><div class="card-head"><h2>Recent payments</h2><a class="small" href="/admin/payments.html">All payments</a></div>${list(data.recent.payments, (p) => `<li><div><a href="/admin/booking-details.html?id=${p.booking.id}"><strong>${esc(p.payment_reference)}</strong></a><div class="small muted">${esc(p.booking.booking_reference)} · ${esc(p.payment_method || p.provider)} · ${ago(p.paid_at || p.updated_at)}</div></div><div class="text-right">${badge(p.payment_status)}<div class="small"><strong>${money(p.amount)}</strong></div></div></li>`, 'No payments yet')}</section>
      <section class="card span-12"><div class="card-head"><h2>Latest registered customers</h2><a class="small" href="/admin/customers.html">All customers</a></div>${list(data.recent.customers, (u) => `<li><div><a href="/admin/customer-details.html?id=${u.id}"><strong>${esc(u.first_name)} ${esc(u.last_name)}</strong></a><div class="small muted">${esc(u.email)}</div></div><div class="text-right">${u.email_verified_at ? '<span class="badge badge-success">Verified</span>' : '<span class="badge badge-warning">Unverified</span>'}<div class="small muted">joined ${ago(u.created_at)}</div></div></li>`, 'No customers yet')}</section>
    </div>`;

  await Promise.all([
    drawRevenue('daily_revenue'),
    drawChart('ch-occ', { kind: 'line', labels: c.occupancy.labels, series: [{ label: 'Occupancy', data: c.occupancy.data }], fmt: (v) => `${Math.round(v)}%`, tickLabel: shortDay, ariaLabel: 'Daily occupancy rate over the last 30 days' }),
    drawChart('ch-trend', { kind: 'line', labels: c.booking_trends.labels, series: [{ label: 'New bookings', data: c.booking_trends.created }, { label: 'Cancelled / expired', data: c.booking_trends.lost }], fmt: (v) => num(v), tickLabel: shortDay, ariaLabel: 'Bookings created and lost per day' }),
    drawChart('ch-pop', { kind: 'hbar', labels: c.popular_room_types.labels, series: [{ label: 'Nights sold', data: c.popular_room_types.data }], fmt: (v) => num(v), ariaLabel: 'Nights sold per room category' }),
    drawChart('ch-pay', { kind: 'hbar', labels: c.payment_methods.labels.map((l) => l.replace('_', ' ')), series: [{ label: 'Collected', data: c.payment_methods.data }], fmt: pesoTick, ariaLabel: 'Amount collected per payment method' }),
  ]);
});

function list(items, row, empty) {
  return items.length ? `<ul class="list-plain">${items.map(row).join('')}</ul>` : emptyState({ title: empty });
}

function drawRevenue(key) {
  const c = data.charts[key];
  return drawChart('ch-revenue', { kind: 'bar', labels: c.labels, series: [{ label: 'Net revenue', data: c.data }], fmt: pesoTick, tickLabel: shortDay, ariaLabel: `${key.split('_')[0]} net revenue` });
}

app.addEventListener('click', async (e) => {
  const r = e.target.closest('[data-rev]');
  if (r) {
    r.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === r));
    const tbtn = $('[data-table="ch-revenue"]');
    tbtn.setAttribute('aria-pressed', 'false');
    tbtn.innerHTML = `${icon('log')} Table`;
    drawRevenue(r.dataset.rev);
  }
  const t = e.target.closest('[data-table]');
  if (t) {
    const id = t.dataset.table;
    const showTable = t.getAttribute('aria-pressed') !== 'true';
    t.setAttribute('aria-pressed', String(showTable));
    t.innerHTML = showTable ? `${icon('chart')} Chart` : `${icon('log')} Table`;
    const v = views[id];
    if (showTable) $(`#${id}`).innerHTML = tableHtml(v.labels, v.series, (x) => v.fmt(x), v.tickLabel || ((l) => l));
    else renderChart($(`#${id}`), v);
  }
});
