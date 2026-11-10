import { api } from '../api.js';
import { $, esc, icon, money, stars, emptyState, errorState, toast, initReveal, imgFallback, loadingState } from '../ui.js';
import { initSite } from '/components/site-shell.js';
import { roomCard } from '/components/room-card.js';
import { searchFormHtml, bindSearchForm } from '/components/search-form.js';

const FACILITIES = [
  { key: /pool/i, title: 'Rooftop pool', text: 'Infinity-edge pool and sun deck, open 6 AM – 10 PM.', ic: 'pool', fallback: 'photo-1564501049412-61c2a3083791' },
  { key: /dining|restaurant|harbor room/i, title: 'All-day dining', text: 'Seasonal Filipino and international plates from breakfast to late.', ic: 'dining', fallback: 'photo-1414235077428-338989a2e8c0' },
  { key: /spa/i, title: 'Lumen Spa', text: 'Signature hilot and aromatherapy treatments.', ic: 'spa', fallback: 'photo-1544161515-4ab6ce6db874' },
  { key: /fitness|gym/i, title: 'Fitness studio', text: 'Open 24 hours with free weights and cardio.', ic: 'dumbbell', fallback: 'photo-1534438327276-14e5300c3a48' },
];
const unsplash = (id, w = 900) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${w}&q=80`;

async function main() {
  const { hotel } = await initSite();

  // Search
  const slot = $('#search-slot');
  slot.innerHTML = searchFormHtml();
  bindSearchForm(slot.querySelector('form'));

  // Hero + intro from hotel settings
  if (hotel) {
    const hero = hotel.images?.[0]?.image_url || unsplash('photo-1542314831-068cd1dbfeeb', 2000);
    $('#hero-media').style.backgroundImage = `url("${hero}")`;
    if (hotel.tagline) $('#hero-title').textContent = hotel.tagline;
    if (hotel.description) $('#intro-text').textContent = hotel.description;
    $('#intro-title').textContent = `Welcome to ${hotel.hotel_name}`;
    $('#contact-list').innerHTML = [
      hotel.address && ['pin', 'Address', esc(hotel.address)],
      hotel.contact_number && ['phone', 'Phone', `<a href="tel:${esc(hotel.contact_number.replace(/\s/g, ''))}">${esc(hotel.contact_number)}</a>`],
      hotel.email && ['mail', 'Email', `<a href="mailto:${esc(hotel.email)}">${esc(hotel.email)}</a>`],
      ['clock', 'Check-in / Check-out', `${esc(hotel.check_in_time)} / ${esc(hotel.check_out_time)}`],
    ].filter(Boolean).map(([ic, label, val]) => `<div class="contact-item"><span class="ic">${icon(ic)}</span><div><strong>${label}</strong>${val}</div></div>`).join('');
    if (hotel.map_embed_url) $('#map').src = hotel.map_embed_url; else $('#map').remove();
    // Facilities use hotel gallery images matched by caption when available
    $('#facilities').innerHTML = FACILITIES.map((f) => {
      const img = hotel.images?.find((i) => f.key.test(i.caption || ''))?.image_url || unsplash(f.fallback);
      return `<article class="facility reveal"><img src="${esc(img)}" alt="${esc(f.title)}" loading="lazy" data-fallback><div class="body"><h3>${esc(f.title)}</h3><p>${esc(f.text)}</p></div></article>`;
    }).join('');
  } else {
    $('#hero-media').style.backgroundImage = `url("${unsplash('photo-1542314831-068cd1dbfeeb', 2000)}")`;
  }

  // Featured rooms
  const roomsEl = $('#featured-rooms');
  roomsEl.innerHTML = loadingState('Loading rooms…');
  const statsEl = $('#intro-stats');
  try {
    const [{ items: featured }, { items: all }] = await Promise.all([api.get('/rooms', { featured: 'true' }), api.get('/rooms')]);
    const show = (featured.length ? featured : all).slice(0, 3);
    roomsEl.innerHTML = show.length ? show.map(roomCard).join('') : emptyState({ icon: 'bed', title: 'Rooms coming soon', text: 'Our room catalogue is being updated.' });
    const totalRooms = all.reduce((s, r) => s + (r.room_count || 0), 0);
    statsEl.children[0].querySelector('.num').textContent = totalRooms || all.length;
  } catch (err) {
    roomsEl.innerHTML = errorState(err, { retry: false });
  }

  // Offers
  try {
    const { items } = await api.get('/offers');
    $('#offer-list').innerHTML = items.length
      ? items.map((o) => `<div class="offer-card reveal">
          <div class="amount">${o.discount_type === 'PERCENTAGE' ? `${o.discount_value}%` : money(o.discount_value).replace('.00', '')}<span style="font-size:1rem;color:rgba(255,255,255,.7)"> off</span></div>
          <h3 class="mb-0">${esc(o.description || 'Special offer')}</h3>
          <p class="small mb-0" style="color:rgba(255,255,255,.65)">${o.minimum_amount ? `Min. booking ${money(o.minimum_amount)}. ` : ''}${o.maximum_discount ? `Up to ${money(o.maximum_discount)} off. ` : ''}Valid until ${new Date(`${o.end_date}T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}.</p>
          <button class="offer-code" data-code="${esc(o.code)}" title="Copy code">${icon('tag')} ${esc(o.code)}</button>
        </div>`).join('')
      : '<p style="color:rgba(255,255,255,.7)">No public promotions right now — check back soon.</p>';
    $('#offer-list').addEventListener('click', async (e) => {
      const b = e.target.closest('[data-code]');
      if (!b) return;
      try { await navigator.clipboard.writeText(b.dataset.code); toast(`Code ${b.dataset.code} copied — apply it at checkout.`, 'success'); } catch { toast(`Use code ${b.dataset.code} at checkout.`); }
    });
  } catch { $('#offers').remove(); }

  // Reviews
  try {
    const r = await api.get('/reviews', { limit: 3 });
    if (r.average) {
      $('#rating-summary').innerHTML = `<span class="score">${r.average.toFixed(1)}</span><div>${stars(Math.round(r.average))}<div class="small muted">from ${r.count} verified stays</div></div>`;
      statsEl.children[1].querySelector('.num').textContent = `${r.average.toFixed(1)}/5`;
    } else statsEl.children[1].remove();
    $('#review-list').innerHTML = r.items.length
      ? r.items.map((v) => `<figure class="review-card reveal">${stars(v.rating)}<blockquote>“${esc(v.comment || v.title)}”</blockquote>
          <figcaption class="who"><span class="avatar">${esc(v.guest_name.charAt(0))}</span><div><strong>${esc(v.guest_name)}</strong><div class="muted small">${esc(v.room_types.join(', '))}</div></div></figcaption></figure>`).join('')
      : emptyState({ icon: 'star', title: 'No reviews yet', text: 'Be the first to share your stay.' });
  } catch { $('#review-list').innerHTML = ''; }

  imgFallback();
  initReveal();
}

main();
