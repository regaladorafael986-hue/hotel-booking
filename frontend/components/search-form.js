// Date / guests / rooms search form (homepage hero + rooms page).
import { $, esc, icon, today, addDaysStr, nightsBetween, validateForm, formValues, setFieldError } from '/assets/js/ui.js';

export function searchFormHtml(v = {}) {
  const ci = v.check_in || today(1);
  const co = v.check_out || addDaysStr(ci, 2);
  const opt = (n, sel, from = 0) => Array.from({ length: n - from + 1 }, (_, i) => i + from).map((i) => `<option value="${i}" ${Number(sel) === i ? 'selected' : ''}>${i}</option>`).join('');
  return `<form class="search-card" novalidate aria-label="Search available rooms">
    <div class="field date"><label for="sf-in">Check-in</label><input id="sf-in" class="input" type="date" name="check_in" required min="${today()}" value="${esc(ci)}"><div class="field-error"></div></div>
    <div class="field date"><label for="sf-out">Check-out</label><input id="sf-out" class="input" type="date" name="check_out" required min="${addDaysStr(ci, 1)}" value="${esc(co)}"><div class="field-error"></div></div>
    <div class="field"><label for="sf-ad">Adults</label><select id="sf-ad" class="select" name="adults">${opt(12, v.adults ?? 2, 1)}</select></div>
    <div class="field"><label for="sf-ch">Children</label><select id="sf-ch" class="select" name="children">${opt(8, v.children ?? 0)}</select></div>
    <div class="field"><label for="sf-rm">Rooms</label><select id="sf-rm" class="select" name="rooms">${opt(6, v.rooms ?? 1, 1)}</select><div class="field-error"></div></div>
    <button class="btn btn-gold btn-lg" type="submit">${icon('search')} Check availability</button>
  </form>`;
}

/** Attach behaviour; `onSearch(values)` or default navigation to /rooms.html. */
export function bindSearchForm(form, onSearch) {
  const ci = $('[name=check_in]', form);
  const co = $('[name=check_out]', form);
  ci.addEventListener('change', () => {
    co.min = addDaysStr(ci.value, 1);
    if (!co.value || co.value <= ci.value) co.value = addDaysStr(ci.value, 1);
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const ok = validateForm(form, {
      check_in: (v) => (v < today() ? 'Check-in cannot be in the past.' : ''),
      check_out: (v, f) => (v <= f.check_in.value ? 'Check-out must be after check-in.' : nightsBetween(f.check_in.value, v) > 30 ? 'Maximum stay is 30 nights.' : ''),
    });
    if (!ok) return;
    const v = formValues(form);
    if (Number(v.rooms) > Number(v.adults)) { setFieldError(form, 'rooms', 'Each room needs at least one adult.'); return; }
    if (onSearch) onSearch(v);
    else location.href = `/rooms.html?${new URLSearchParams(v)}`;
  });
}
