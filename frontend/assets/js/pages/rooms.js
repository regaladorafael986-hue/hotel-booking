import { api } from '../api.js';
import { $, $$, esc, params, loadingState, emptyState, errorState, date, plural, imgFallback, formValues, fillForm } from '../ui.js';
import { amenityIcon } from '../icons.js';
import { initSite } from '/components/site-shell.js';
import { roomRow } from '/components/room-card.js';
import { searchFormHtml, bindSearchForm } from '/components/search-form.js';

const list = $('#room-list');
const filterForm = $('#filter-form');
let state = params();

function currentFilters() {
  const v = formValues(filterForm);
  return { min_price: v.min_price, max_price: v.max_price, room_type_id: v.room_type_id, bed_type: v.bed_type, capacity: v.capacity, amenities: v.amenities || [] };
}

function sortRooms(items) {
  const s = $('#sort').value;
  const by = { price_asc: (a, b) => a.base_price - b.base_price, price_desc: (a, b) => b.base_price - a.base_price, capacity: (a, b) => b.max_guests - a.max_guests }[s];
  return items.slice().sort(by);
}

async function load() {
  list.innerHTML = loadingState('Checking availability…');
  const f = currentFilters();
  const hasDates = state.check_in && state.check_out;
  try {
    let items;
    if (hasDates) {
      const r = await api.get('/rooms/availability', { check_in: state.check_in, check_out: state.check_out, adults: state.adults || 2, children: state.children || 0, rooms: state.rooms || 1, ...f });
      items = r.items;
      $('#result-sub').textContent = `${date(state.check_in)} → ${date(state.check_out)} · ${plural(r.search.nights, 'night')} · ${plural(r.search.adults, 'adult')}${r.search.children ? `, ${plural(r.search.children, 'child', 'children')}` : ''} · ${plural(r.search.rooms, 'room')}`;
    } else {
      items = (await api.get('/rooms', f)).items;
      if (f.room_type_id) items = items.filter((i) => String(i.id) === String(f.room_type_id));
      $('#result-sub').textContent = 'Select dates above to see availability and stay totals.';
    }
    items = sortRooms(items);
    $('#result-count').textContent = hasDates ? `${plural(items.length, 'room type')} available` : `${plural(items.length, 'room type')}`;
    list.innerHTML = items.length
      ? items.map((r) => roomRow(r, hasDates ? state : null)).join('')
      : emptyState({ icon: 'calendar', title: hasDates ? 'No rooms available for these dates' : 'No rooms match your filters', text: hasDates ? 'Try different dates, fewer rooms, or remove some filters.' : 'Try removing some filters.', action: '<button class="btn btn-outline" data-clear>Clear filters</button>' });
    imgFallback(list);
  } catch (err) {
    list.innerHTML = errorState(err);
    list.querySelector('[data-retry]')?.addEventListener('click', load);
  }
}

async function main() {
  await initSite();
  $('#search-slot').innerHTML = searchFormHtml(state);
  bindSearchForm($('#search-slot form'), (v) => {
    state = { ...state, ...v };
    history.replaceState(null, '', `?${new URLSearchParams(state)}`);
    load();
  });

  try {
    const [{ bed_types, amenities }, { items: types }] = await Promise.all([api.get('/rooms/filters'), api.get('/rooms')]);
    $('#f-bed').insertAdjacentHTML('beforeend', bed_types.map((b) => `<option>${esc(b)}</option>`).join(''));
    $('#f-type').insertAdjacentHTML('beforeend', types.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join(''));
    $('#f-amenities').innerHTML = amenities.map((a) => `<label class="chip-check"><input type="checkbox" name="amenities" value="${a.id}" data-type="array"><span>${amenityIcon(a.icon)}${esc(a.name)}</span></label>`).join('');
  } catch { /* filters are optional; listing still works */ }
  if (state.room_type_id || state.min_price) fillForm(filterForm, state);

  filterForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const { min_price: mn, max_price: mx } = formValues(filterForm);
    const err = $('#price-error');
    err.textContent = mn && mx && Number(mn) > Number(mx) ? 'Minimum price must be lower than maximum.' : '';
    if (err.textContent) return;
    $('#filters').classList.remove('open');
    load();
  });
  filterForm.addEventListener('reset', () => setTimeout(load));
  list.addEventListener('click', (e) => { if (e.target.closest('[data-clear]')) { filterForm.reset(); } });
  $('#sort').addEventListener('change', load);
  $('#filter-toggle').addEventListener('click', (e) => {
    const open = $('#filters').classList.toggle('open');
    e.currentTarget.setAttribute('aria-expanded', String(open));
  });
  $$('#f-amenities input').forEach((i) => i.addEventListener('change', () => { if (!window.matchMedia('(max-width: 980px)').matches) load(); }));
  load();
}

main();
