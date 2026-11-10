import { api } from '../../api.js';
import { $, esc, icon, loadInto, validateForm, formValues, fillForm, showErrors, withLoading, toast, toastError, confirmDialog, emptyState } from '../../ui.js';
import { initDashboard } from '/components/dashboard-shell.js';

const app = $('#app');
await initDashboard({ area: 'ADMIN', active: 'settings', title: 'Hotel settings' });

function imagesHtml(images) {
  return `<label class="dropzone mb-2">${icon('upload')}<div><strong>Upload hotel photos</strong> — the first photo is used as the homepage hero</div><div class="small">JPG, PNG or WEBP · max 5 MB each</div><input type="file" id="hotel-files" accept="image/jpeg,image/png,image/webp" multiple class="sr-only"></label>
    ${images.length ? `<div class="img-thumbs">${images.map((i, n) => `<div class="img-thumb ${n === 0 ? 'primary' : ''}"><img src="${esc(i.image_url.replace(/w=\d+/, 'w=400'))}" alt="${esc(i.caption || '')}">${n === 0 ? '<span class="tag badge badge-gold plain">Hero</span>' : ''}<div class="tools"><button type="button" data-del="${i.id}" style="color:var(--danger)">Delete</button></div></div>`).join('')}</div>` : emptyState({ icon: 'image', title: 'No hotel photos yet' })}`;
}

async function load() {
  await loadInto(app, async () => {
    const s = await api.get('/admin/settings');
    app.innerHTML = `<div class="page-head"><div><h1>Hotel settings</h1><p>Information shown across the website, emails and receipts.</p></div></div>
    <form id="sf" novalidate class="stack" style="--stack:20px">
      <section class="card"><div class="card-head"><h2>Hotel information</h2></div><div class="card-body form-grid">
        <div class="field"><label for="hn">Hotel name</label><input id="hn" class="input" name="hotel_name" required minlength="2" maxlength="120"><div class="field-error"></div></div>
        <div class="field"><label for="tg">Tagline</label><input id="tg" class="input" name="tagline" maxlength="200"><div class="field-error"></div></div>
        <div class="field span-2"><label for="ds">Description</label><textarea id="ds" class="textarea" name="description" maxlength="5000"></textarea><div class="field-error"></div></div>
        <div class="field span-2"><label for="ad">Address</label><input id="ad" class="input" name="address" maxlength="255"><div class="field-error"></div></div>
        <div class="field"><label for="cn">Contact number</label><input id="cn" class="input" name="contact_number" maxlength="40"><div class="field-error"></div></div>
        <div class="field"><label for="em">Reservations email</label><input id="em" class="input" type="email" name="email" maxlength="191"><div class="hint">Website enquiries are sent here.</div><div class="field-error"></div></div>
        <div class="field span-2"><label for="mp">Google Maps embed URL</label><input id="mp" class="input" type="url" name="map_embed_url" maxlength="500" placeholder="https://www.google.com/maps?q=…&output=embed"><div class="field-error"></div></div>
        <div class="field"><label for="fb">Facebook URL</label><input id="fb" class="input" type="url" name="facebook_url" maxlength="255"><div class="field-error"></div></div>
        <div class="field"><label for="ig">Instagram URL</label><input id="ig" class="input" type="url" name="instagram_url" maxlength="255"><div class="field-error"></div></div>
      </div></section>
      <section class="card"><div class="card-head"><h2>Stay rules &amp; pricing</h2></div><div class="card-body form-grid">
        <div class="field"><label for="cit">Check-in time</label><input id="cit" class="input" type="time" name="check_in_time" required><div class="field-error"></div></div>
        <div class="field"><label for="cot">Check-out time</label><input id="cot" class="input" type="time" name="check_out_time" required><div class="field-error"></div></div>
        <div class="field"><label for="tax">Tax rate (%)</label><input id="tax" class="input" type="number" name="tax_rate" required min="0" max="50" step="0.01" data-type="number"><div class="hint">Applied to the discounted subtotal of new bookings.</div><div class="field-error"></div></div>
        <div class="field"><label for="hold">Online payment hold (minutes)</label><input id="hold" class="input" type="number" name="hold_minutes" required min="5" max="120" data-type="number"><div class="hint">How long rooms are held while a guest pays online.</div><div class="field-error"></div></div>
        <div class="field"><label for="fch">Free cancellation window (hours before check-in)</label><input id="fch" class="input" type="number" name="free_cancellation_hours" required min="0" max="720" data-type="number"><div class="field-error"></div></div>
        <div class="field"><span class="label">Pay-at-hotel confirmation</span><label class="check" style="min-height:44px;align-items:center"><input type="checkbox" name="pay_at_hotel_auto_confirm"> <span>Confirm pay-at-hotel reservations automatically</span></label><div class="hint">If off, they wait for staff confirmation.</div></div>
        <div class="field span-2"><label for="cp">Cancellation policy</label><textarea id="cp" class="textarea" name="cancellation_policy" maxlength="5000"></textarea><div class="field-error"></div></div>
        <div class="field span-2"><label for="hp">Hotel policies / house rules</label><textarea id="hp" class="textarea" name="hotel_policies" maxlength="10000" style="min-height:160px"></textarea><div class="hint">One rule per line.</div><div class="field-error"></div></div>
      </div></section>
      <div class="row" style="justify-content:flex-end"><button class="btn btn-lg" type="submit">Save settings</button></div>
    </form>
    <section class="card mt-3"><div class="card-head"><h2>Hotel photos</h2></div><div class="card-body" id="imgs">${imagesHtml(s.images)}</div></section>`;
    const form = $('#sf');
    fillForm(form, s);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!validateForm(form)) return;
      await withLoading(form.querySelector('[type=submit]'), async () => {
        try {
          const r = await api.put('/admin/settings', formValues(form));
          sessionStorage.removeItem('se.hotel');
          toast(r.message, 'success');
        } catch (err) { showErrors(form, err); }
      });
    });
    const imgs = $('#imgs');
    imgs.addEventListener('change', async (e) => {
      if (e.target.id !== 'hotel-files') return;
      const files = [...e.target.files];
      const bad = files.find((f) => !['image/jpeg', 'image/png', 'image/webp'].includes(f.type) || f.size > 5 * 1024 * 1024);
      if (bad) return toast(`${bad.name}: only JPG/PNG/WEBP up to 5 MB.`, 'error');
      const fd = new FormData();
      files.slice(0, 10).forEach((f) => fd.append('images', f));
      try { const r = await api.upload('/admin/settings/images', fd); toast(r.message, 'success'); sessionStorage.removeItem('se.hotel'); load(); } catch (err) { toastError(err); }
    });
    imgs.addEventListener('click', async (e) => {
      const d = e.target.closest('[data-del]');
      if (!d || !(await confirmDialog({ title: 'Delete photo?', message: 'It will be removed from the website.', confirmText: 'Delete', danger: true }))) return;
      try { await api.del(`/admin/settings/images/${d.dataset.del}`); sessionStorage.removeItem('se.hotel'); load(); } catch (err) { toastError(err); }
    });
  });
}
load();
