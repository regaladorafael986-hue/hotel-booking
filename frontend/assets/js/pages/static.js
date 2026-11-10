// about.html, contact.html, policies.html, 404.html
import { api } from '../api.js';
import { $, $$, esc, icon, validateForm, formValues, showErrors, withLoading, toast } from '../ui.js';
import { initSite } from '/components/site-shell.js';

async function main() {
  const { hotel, user } = await initSite();
  if (hotel) {
    $$('[data-bind]').forEach((el) => {
      const v = hotel[el.dataset.bind];
      if (v !== null && v !== undefined && v !== '') el.textContent = String(v);
    });
  }

  if (document.body.dataset.page === 'contact') {
    if (hotel) {
      $('#contact-list').innerHTML = [
        hotel.address && ['pin', 'Address', esc(hotel.address)],
        hotel.contact_number && ['phone', 'Phone', `<a href="tel:${esc(hotel.contact_number.replace(/\s/g, ''))}">${esc(hotel.contact_number)}</a>`],
        hotel.email && ['mail', 'Email', `<a href="mailto:${esc(hotel.email)}">${esc(hotel.email)}</a>`],
        ['clock', 'Front desk', 'Open 24 hours, every day'],
      ].filter(Boolean).map(([ic, l, v]) => `<div class="contact-item"><span class="ic">${icon(ic)}</span><div><strong>${l}</strong>${v}</div></div>`).join('');
      if (hotel.map_embed_url) $('#map').src = hotel.map_embed_url; else $('#map').remove();
    }
    const form = $('#contact-form');
    if (user) { form.name.value = `${user.first_name} ${user.last_name}`; form.email.value = user.email; form.phone.value = user.phone || ''; }
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!validateForm(form)) return;
      await withLoading(form.querySelector('[type=submit]'), async () => {
        try {
          const r = await api.post('/contact', formValues(form));
          form.reset();
          toast(r.message, 'success', 7000);
        } catch (err) { showErrors(form, err); }
      });
    });
  }
}

main();
