import { api } from '../../api.js';
import { $, esc, date, badge, stars, loadInto, emptyState } from '../../ui.js';
import { initDashboard } from '/components/dashboard-shell.js';
import { reviewDialog } from './common.js';

const app = $('#app');
await initDashboard({ area: 'CUSTOMER', active: 'reviews', title: 'My reviews' });

async function load() {
  await loadInto(app, async () => {
    const [{ items: reviews }, completed] = await Promise.all([api.get('/reviews/my'), api.get('/bookings/my', { status: 'completed', page_size: 50 })]);
    const pending = completed.items.filter((b) => b.can_review);
    app.innerHTML = `<div class="page-head"><div><h1>My reviews</h1><p>Share your experience to help other guests.</p></div></div>
      ${pending.length ? `<section class="card mb-3"><div class="card-head"><h2>Stays awaiting your review</h2></div><ul class="list-plain">${pending.map((b) => `<li><div><strong>${esc(b.room_summary.map((r) => r.name).join(', '))}</strong><div class="small muted">${date(b.check_in)} – ${date(b.check_out)} · ${esc(b.booking_reference)}</div></div><button class="btn btn-gold btn-sm" data-review="${b.id}">Write a review</button></li>`).join('')}</ul></section>` : ''}
      <section class="card"><div class="card-head"><h2>Submitted reviews</h2></div>
        ${reviews.length ? `<ul class="list-plain">${reviews.map((r) => `<li style="align-items:flex-start"><div>${stars(r.rating)}${r.title ? ` <strong>${esc(r.title)}</strong>` : ''}<p class="mb-0 mt-1">${esc(r.comment || '')}</p><div class="small muted mt-1"><a href="/customer/booking-details.html?id=${r.booking.id}">${esc(r.booking.booking_reference)}</a> · ${date(r.booking.check_in)} · submitted ${date(r.created_at)}</div></div>${badge(r.status, r.status === 'PENDING' ? 'Awaiting moderation' : r.status === 'APPROVED' ? 'Published' : 'Not published')}</li>`).join('')}</ul>`
          : emptyState({ icon: 'star', title: 'No reviews yet', text: 'After you check out, you can review your stay here.' })}
      </section>`;
    app.querySelectorAll('[data-review]').forEach((btn) => btn.addEventListener('click', async () => {
      const b = pending.find((x) => String(x.id) === btn.dataset.review);
      if (await reviewDialog(b)) load();
    }));
  });
}
load();
