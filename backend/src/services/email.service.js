// Transactional email via Brevo (https://developers.brevo.com/reference/sendtransacemail).
// Without BREVO_API_KEY (development), emails are printed to the console and saved to storage/outbox/.
const fs = require('fs');
const path = require('path');
const env = require('../config/env');

const OUTBOX = path.join(__dirname, '..', '..', 'storage', 'outbox');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const peso = (n) => `₱${Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const longDate = (d) => new Date(`${typeof d === 'string' ? d : d.toISOString().slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

function layout({ title, preheader = '', body, cta, hotelName = 'StayEase' }) {
  const button = cta
    ? `<p style="margin:28px 0"><a href="${esc(cta.url)}" style="background:#172B3A;color:#fff;text-decoration:none;padding:13px 26px;border-radius:6px;font-weight:600;display:inline-block">${esc(cta.label)}</a></p>
       <p style="font-size:12px;color:#6b7280">If the button doesn't work, copy this link into your browser:<br><span style="word-break:break-all">${esc(cta.url)}</span></p>`
    : '';
  return `<!doctype html><html><body style="margin:0;background:#F7F4EF;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#30343B">
<span style="display:none">${esc(preheader)}</span>
<table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:10px;overflow:hidden">
<tr><td style="background:#172B3A;padding:22px 32px;color:#fff;font-family:Georgia,serif;font-size:22px;letter-spacing:.5px">${esc(hotelName)} <span style="color:#C6A56B">✦</span></td></tr>
<tr><td style="padding:32px">
<h1 style="font-family:Georgia,serif;font-weight:normal;font-size:24px;margin:0 0 16px;color:#172B3A">${esc(title)}</h1>
${body}${button}
</td></tr>
<tr><td style="padding:18px 32px;background:#F7F4EF;font-size:12px;color:#6b7280">This is an automated message from ${esc(hotelName)}. Please do not reply directly to this email.</td></tr>
</table></td></tr></table></body></html>`;
}

function bookingSummary(b) {
  const rows = [
    ['Booking reference', `<strong>${esc(b.bookingReference)}</strong>`],
    ['Guest', esc(`${b.guestFirstName} ${b.guestLastName}`)],
    ['Check-in', longDate(b.checkIn)],
    ['Check-out', longDate(b.checkOut)],
    ['Nights', b.nights],
    ['Guests', `${b.adults} adult(s)${b.children ? `, ${b.children} child(ren)` : ''}`],
    ['Rooms', b.rooms?.length ? esc(b.rooms.map((r) => r.roomType?.name).filter(Boolean).join(', ')) : b.totalRooms],
    ['Total', `<strong>${peso(b.totalAmount)}</strong>`],
    ['Payment', b.paymentMethod === 'ONLINE' ? 'Online payment' : 'Pay at hotel'],
  ];
  return `<table cellpadding="6" style="border-collapse:collapse;width:100%;font-size:14px;margin:12px 0">${rows
    .map(([k, v]) => `<tr><td style="color:#6b7280;border-bottom:1px solid #E9EAEC;width:42%">${k}</td><td style="border-bottom:1px solid #E9EAEC">${v}</td></tr>`)
    .join('')}</table>`;
}

const bookingUrl = (b) => `${env.appUrl}/customer/booking-details.html?id=${b.id}`;

const templates = {
  verifyEmail: ({ user, url }) => ({
    subject: 'Verify your StayEase email address',
    html: layout({ title: `Welcome, ${user.firstName}!`, preheader: 'Confirm your email to start booking.', body: '<p>Thanks for creating a StayEase account. Please confirm your email address so you can make reservations. This link expires in 24 hours.</p>', cta: { label: 'Verify email address', url } }),
  }),
  passwordReset: ({ user, url }) => ({
    subject: 'Reset your StayEase password',
    html: layout({ title: 'Password reset request', body: `<p>Hi ${esc(user.firstName)}, we received a request to reset your password. This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>`, cta: { label: 'Choose a new password', url } }),
  }),
  bookingReceived: ({ booking }) => ({
    subject: `Reservation received — ${booking.bookingReference}`,
    html: layout({ title: 'We received your reservation', body: `<p>Thank you for choosing us. Your reservation is <strong>awaiting confirmation</strong> by the hotel. We'll email you once it's confirmed.</p>${bookingSummary(booking)}`, cta: { label: 'View booking', url: bookingUrl(booking) } }),
  }),
  bookingConfirmed: ({ booking }) => ({
    subject: `Booking confirmed — ${booking.bookingReference}`,
    html: layout({ title: 'Your stay is confirmed', preheader: `Booking ${booking.bookingReference}`, body: `<p>We look forward to welcoming you.${booking.paymentMethod === 'PAY_AT_HOTEL' ? ' Payment will be collected at the front desk upon arrival.' : ''}</p>${bookingSummary(booking)}<p style="font-size:13px;color:#6b7280">Please present your booking reference and a valid ID at check-in.</p>`, cta: { label: 'View booking', url: bookingUrl(booking) } }),
  }),
  paymentConfirmed: ({ booking, payment }) => ({
    subject: `Payment received — ${booking.bookingReference}`,
    html: layout({ title: 'Payment received', body: `<p>We received your payment of <strong>${peso(payment.amount)}</strong>${payment.paymentMethod ? ` via ${esc(payment.paymentMethod)}` : ''}. Reference: <strong>${esc(payment.paymentReference)}</strong>.</p>${bookingSummary(booking)}`, cta: { label: 'Download receipt', url: bookingUrl(booking) } }),
  }),
  paymentFailed: ({ booking }) => ({
    subject: `Payment not completed — ${booking.bookingReference}`,
    html: layout({ title: 'Your payment did not go through', body: `<p>We couldn't complete the payment for booking <strong>${esc(booking.bookingReference)}</strong>. Your rooms are held until ${booking.expiresAt ? new Date(booking.expiresAt).toLocaleTimeString('en-PH', { timeZone: env.timezone, hour: '2-digit', minute: '2-digit' }) : 'the hold expires'}. You can try paying again from your booking page.</p>`, cta: { label: 'Retry payment', url: bookingUrl(booking) } }),
  }),
  bookingCancelled: ({ booking, reason }) => ({
    subject: `Booking cancelled — ${booking.bookingReference}`,
    html: layout({ title: 'Your booking has been cancelled', body: `<p>Booking <strong>${esc(booking.bookingReference)}</strong> has been cancelled.${reason ? ` Reason: ${esc(reason)}` : ''}</p>${Number(booking.amountPaid) > 0 ? '<p>If you are eligible for a refund, you will receive a separate email when it is processed.</p>' : ''}`, cta: { label: 'View booking', url: bookingUrl(booking) } }),
  }),
  bookingExpired: ({ booking }) => ({
    subject: `Reservation hold expired — ${booking.bookingReference}`,
    html: layout({ title: 'Your reservation hold expired', body: `<p>We didn't receive payment for booking <strong>${esc(booking.bookingReference)}</strong> in time, so the rooms have been released. You're welcome to make a new reservation.</p>`, cta: { label: 'Search rooms', url: `${env.appUrl}/rooms.html` } }),
  }),
  cancellationUpdate: ({ booking, approved, note }) => ({
    subject: `Cancellation request ${approved ? 'approved' : 'declined'} — ${booking.bookingReference}`,
    html: layout({ title: `Cancellation request ${approved ? 'approved' : 'declined'}`, body: `<p>Your cancellation request for booking <strong>${esc(booking.bookingReference)}</strong> was ${approved ? 'approved' : 'declined'}.${note ? ` Note from the hotel: ${esc(note)}` : ''}</p>`, cta: { label: 'View booking', url: bookingUrl(booking) } }),
  }),
  checkInReminder: ({ booking, settings }) => ({
    subject: `See you tomorrow — ${booking.bookingReference}`,
    html: layout({ title: 'Your stay begins tomorrow', body: `<p>A friendly reminder that check-in starts at <strong>${esc(settings?.checkInTime || '14:00')}</strong>.${booking.paymentStatus !== 'PAID' ? ` A balance of <strong>${peso(Number(booking.totalAmount) - Number(booking.amountPaid))}</strong> will be collected at the front desk.` : ''}</p>${bookingSummary(booking)}${settings?.address ? `<p style="font-size:13px">Address: ${esc(settings.address)}</p>` : ''}`, cta: { label: 'View booking', url: bookingUrl(booking) } }),
  }),
  contactMessage: ({ name, email: from, phone, subject, message }) => ({
    subject: `Website enquiry: ${subject}`,
    html: layout({ title: 'New website enquiry', body: `<p><strong>From:</strong> ${esc(name)} &lt;${esc(from)}&gt;${phone ? ` · ${esc(phone)}` : ''}</p><p><strong>Subject:</strong> ${esc(subject)}</p><p style="white-space:pre-line;border-left:3px solid #C6A56B;padding-left:12px">${esc(message)}</p>` }),
  }),
  refundUpdate: ({ booking, refund }) => ({
    subject: `Refund ${refund.refundStatus === 'SUCCEEDED' ? 'processed' : 'update'} — ${booking.bookingReference}`,
    html: layout({ title: refund.refundStatus === 'SUCCEEDED' ? 'Your refund has been processed' : refund.refundStatus === 'FAILED' ? 'Refund could not be processed' : 'Refund in progress', body: `<p>Refund of <strong>${peso(refund.amount)}</strong> for booking <strong>${esc(booking.bookingReference)}</strong>: <strong>${esc(refund.refundStatus.toLowerCase())}</strong>.${refund.refundStatus === 'SUCCEEDED' ? ' Depending on your bank or e-wallet, it may take 5–10 business days to reflect.' : ''}</p>` }),
  }),
};

async function deliver({ to, toName, subject, html }) {
  if (!env.brevo.apiKey) {
    if (env.isVercel) {
      // Read-only filesystem: log only. Links (which can contain password-reset tokens) are logged on
      // preview deployments only, never in production.
      const links = process.env.VERCEL_ENV === 'production' ? [] : [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));
      console.log(`[email:not-sent] BREVO_API_KEY is not set. To: ${to} | ${subject}${links.length ? ` | Link: ${links[0]}` : ''}`);
    } else if (!env.isTest) {
      fs.mkdirSync(OUTBOX, { recursive: true });
      const file = path.join(OUTBOX, `${Date.now()}-${subject.replace(/[^a-z0-9]+/gi, '-').slice(0, 60)}.html`);
      fs.writeFileSync(file, html);
      const links = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));
      console.log(`\n[email:dev] To: ${to} | ${subject}${links.length ? `\n            Link: ${links[0]}` : ''}\n            Saved: ${file}`);
    }
    return { delivered: false, dev: true };
  }
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': env.brevo.apiKey, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ sender: { email: env.brevo.fromEmail, name: env.brevo.fromName }, to: [{ email: to, name: toName || to }], subject, htmlContent: html }),
  });
  if (!res.ok) throw new Error(`Brevo responded ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return { delivered: true };
}

/** Send a templated email. Failures are logged but never break the business operation that triggered them. */
async function send(templateName, to, data, toName) {
  try {
    const { subject, html } = templates[templateName](data);
    return await deliver({ to, toName, subject, html });
  } catch (err) {
    console.error(`[email] failed to send "${templateName}" to ${to}:`, err.message);
    return { delivered: false, error: err.message };
  }
}

module.exports = { send, templates };
