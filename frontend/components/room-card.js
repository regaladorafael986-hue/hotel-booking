// Room presentation components used on the homepage, rooms listing and booking pages.
import { esc, money, moneyShort, icon, plural } from '/assets/js/ui.js';
import { amenityIcon } from '/assets/js/icons.js';

const sized = (url, w) => (url && url.includes('images.unsplash.com') ? url.replace(/w=\d+/, `w=${w}`) : url);
export const roomImage = (room, w = 900) => sized(room.primary_image || room.images?.[0]?.image_url, w) || '';

function availabilityText(room, search) {
  if (!search || room.available_rooms === undefined) return '';
  const n = room.available_rooms;
  if (n <= 0) return '<span class="avail none">Fully booked</span>';
  if (n <= 2) return `<span class="avail low">Only ${n} left for your dates</span>`;
  return `<span class="avail ok">${icon('check')} Available</span>`;
}

function stayQuery(search, room) {
  const p = new URLSearchParams({ id: room.slug || room.id });
  if (search) for (const k of ['check_in', 'check_out', 'adults', 'children', 'rooms']) if (search[k] !== undefined && search[k] !== '') p.set(k, search[k]);
  return p.toString();
}

export const amenityPills = (amenities, max = 4) => `<div class="amenity-list">${amenities.slice(0, max).map((a) => `<span class="amenity-pill">${amenityIcon(a.icon)}${esc(a.name)}</span>`).join('')}${amenities.length > max ? `<span class="amenity-pill">+${amenities.length - max} more</span>` : ''}</div>`;

export const roomMeta = (room) => `<div class="room-meta">
    <span>${icon('users')} Up to ${plural(room.max_adults, 'adult')}${room.max_children ? ` + ${plural(room.max_children, 'child', 'children')}` : ''}</span>
    <span>${icon('bed')} ${esc(room.bed_type)}</span>
    ${room.size_sqm ? `<span>${icon('size')} ${room.size_sqm} m²</span>` : ''}
  </div>`;

/** Vertical card (homepage featured rooms). */
export function roomCard(room) {
  const href = `/room-details.html?${stayQuery(null, room)}`;
  return `<article class="room-card reveal">
    <a class="media" href="${href}" tabindex="-1"><img src="${esc(roomImage(room))}" alt="${esc(room.name)}" loading="lazy" data-fallback>
      <span class="price-tag">from <strong>${moneyShort(room.base_price)}</strong> / night</span></a>
    <div class="body">
      <h3><a href="${href}">${esc(room.name)}</a></h3>
      <p>${esc(room.short_description || '')}</p>
      ${roomMeta(room)}
      <div class="foot"><a class="btn btn-outline btn-sm" href="${href}">View details</a><a class="btn btn-sm" href="/booking.html?${stayQuery(null, room)}">Book now</a></div>
    </div>
  </article>`;
}

/** Horizontal row (rooms listing / search results). */
export function roomRow(room, search) {
  const q = stayQuery(search, room);
  const unavailable = search && room.available_rooms !== undefined && room.available_rooms < (Number(search.rooms) || 1);
  const nights = room.nights;
  return `<article class="room-row">
    <a class="media" href="/room-details.html?${q}" tabindex="-1"><img src="${esc(roomImage(room))}" alt="${esc(room.name)}" loading="lazy" data-fallback>${room.is_featured ? '<span class="badge badge-gold plain" style="position:absolute;top:14px;left:14px">Guest favourite</span>' : ''}</a>
    <div class="body">
      <div class="row between"><h3><a href="/room-details.html?${q}">${esc(room.name)}</a></h3>${availabilityText(room, search)}</div>
      <p class="muted mb-0">${esc(room.short_description || '')}</p>
      ${roomMeta(room)}
      ${amenityPills(room.amenities || [], 5)}
      <div class="foot">
        <div class="price">${nights ? `${plural(nights, 'night')}${Number(search?.rooms) > 1 ? ` · ${search.rooms} rooms` : ''}` : 'Per night from'}<strong>${money(nights ? room.stay_price : room.base_price)}</strong>${nights ? `<span>${moneyShort(room.base_price)} / room / night · taxes extra</span>` : '<span>Taxes and fees extra</span>'}</div>
        <div class="row"><a class="btn btn-outline" href="/room-details.html?${q}">View details</a>${unavailable ? '<button class="btn" disabled>Unavailable</button>' : `<a class="btn" href="/booking.html?${q}">Book now</a>`}</div>
      </div>
    </div>
  </article>`;
}
