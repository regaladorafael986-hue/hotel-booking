// Shared pieces for the customer account area.
import { api } from '../../api.js';
import { esc, money, date, plural, badge, icon, modal, validateForm, formValues, showErrors, withLoading, toast } from '../../ui.js';

export function bookingTile(b) {
  const img = b.rooms?.[0]?.room_type?.images?.[0]?.image_url;
  return `<div class="booking-tile">
    <div class="thumb">${img ? `<img src="${esc(img.replace(/w=\d+/, 'w=400'))}" alt="" loading="lazy" data-fallback>` : ''}</div>
    <div>
      <h3><a href="/customer/booking-details.html?id=${b.id}" style="text-decoration:none">${esc(b.room_summary.map((r) => `${r.name}${r.quantity > 1 ? ` × ${r.quantity}` : ''}`).join(', '))}</a></h3>
      <div class="small muted">${date(b.check_in)} → ${date(b.check_out)} · ${plural(b.nights, 'night')} · ${plural(b.adults + b.children, 'guest')}</div>
      <div class="row mt-1" style="gap:6px">${badge(b.booking_status)}${b.cancellation_status === 'REQUESTED' ? badge('REQUESTED') : ''}${['CANCELLED', 'EXPIRED'].includes(b.booking_status) && b.payment_status === 'PENDING' ? '' : badge(b.payment_status)}</div>
    </div>
    <div class="side text-right">
      <div class="small muted">${esc(b.booking_reference)}</div>
      <div style="font-weight:700;color:var(--navy);font-size:1.05rem">${money(b.total_amount)}</div>
      <div class="row mt-1" style="justify-content:flex-end;gap:6px">${b.can_pay ? `<a class="btn btn-gold btn-sm" href="/customer/booking-details.html?id=${b.id}#pay">Pay now</a>` : ''}${b.can_review ? `<a class="btn btn-outline btn-sm" href="/customer/booking-details.html?id=${b.id}#review">Review</a>` : ''}<a class="btn btn-outline btn-sm" href="/customer/booking-details.html?id=${b.id}">Details</a></div>
    </div>
  </div>`;
}

/** Star-rating review dialog. Resolves true when a review was submitted. */
export function reviewDialog(booking) {
  return new Promise((resolve) => {
    let sent = false;
    const { el } = modal({
      title: 'Review your stay',
      body: `<form id="review-form" class="stack" novalidate>
        <p class="muted mb-0">${esc(booking.room_summary.map((r) => r.name).join(', '))} · ${date(booking.check_in)} – ${date(booking.check_out)}</p>
        <div class="field"><span class="label">Your rating</span>
          <div class="star-input">${[5, 4, 3, 2, 1].map((n) => `<input type="radio" id="star${n}" name="rating" value="${n}" required data-required-msg="Please choose a rating."><label for="star${n}" title="${n} star${n > 1 ? 's' : ''}">★</label>`).join('')}</div>
          <div class="field-error"></div></div>
        <div class="field"><label for="rv-title">Title <span class="muted">(optional)</span></label><input id="rv-title" class="input" name="title" maxlength="120" placeholder="Sum up your stay"></div>
        <div class="field"><label for="rv-comment">Your review</label><textarea id="rv-comment" class="textarea" name="comment" required minlength="10" maxlength="2000" placeholder="What did you enjoy? What could be better?"></textarea><div class="field-error"></div></div>
        <p class="small muted mb-0">Reviews are published after a quick moderation check.</p>
      </form>`,
      onClose: () => resolve(sent),
      actions: [
        { label: 'Cancel' },
        {
          label: 'Submit review', cls: 'btn',
          onClick: async (close, m, btn) => {
            const form = m.querySelector('#review-form');
            if (!validateForm(form)) return;
            const v = formValues(form);
            await withLoading(btn, async () => {
              try {
                const r = await api.post('/reviews', { booking_id: booking.id, rating: Number(v.rating), title: v.title, comment: v.comment });
                toast(r.message, 'success');
                sent = true;
                close();
              } catch (err) { showErrors(form, err); }
            });
          },
        },
      ],
    });
    return el;
  });
}

export const flash = () => { const m = sessionStorage.getItem('se.flash'); sessionStorage.removeItem('se.flash'); return m; };
export { icon };
