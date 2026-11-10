/**
 * PayMongo provider (Philippines) — hosted Checkout Sessions supporting GCash, Maya and cards.
 * Docs: https://developers.paymongo.com/reference/checkout-session-resource
 *
 * Required env: PAYMONGO_SECRET_KEY, PAYMONGO_WEBHOOK_SECRET (from the webhook you register for
 * `checkout_session.payment.paid`, `payment.failed`, `payment.refund.updated` pointing to
 * {APP_URL}/api/v1/payments/webhook). This integration is NOT live until those credentials are configured
 * and verified against PayMongo's current API in test mode.
 */
const env = require('../../config/env');
const AppError = require('../../utils/AppError');
const { hmacSha256, safeEqual } = require('../../utils/crypto');
const { toCents } = require('../../utils/money');

const API = 'https://api.paymongo.com/v1';
const SIGNATURE_TOLERANCE_S = 300;

function authHeader() {
  if (!env.payments.paymongoSecretKey) throw new AppError(503, 'Online payment is not configured yet. Please choose Pay at Hotel or try again later.', { code: 'PAYMENTS_NOT_CONFIGURED' });
  return `Basic ${Buffer.from(`${env.payments.paymongoSecretKey}:`).toString('base64')}`;
}

async function call(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { authorization: authHeader(), 'content-type': 'application/json', accept: 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data?.errors?.[0]?.detail || `HTTP ${res.status}`;
    console.error('[paymongo]', method, path, detail);
    throw new AppError(502, `The payment provider rejected the request: ${detail}`, { code: 'PROVIDER_ERROR' });
  }
  return data;
}

const METHOD_MAP = { gcash: 'GCASH', paymaya: 'MAYA', card: 'CARD', grab_pay: 'GRABPAY', dob: 'ONLINE_BANKING', billease: 'BILLEASE' };

module.exports = {
  name: 'PAYMONGO',

  async createCheckout({ payment, booking, successUrl, cancelUrl }) {
    const data = await call('POST', '/checkout_sessions', {
      data: {
        attributes: {
          line_items: [{ name: `StayEase booking ${booking.bookingReference}`, amount: toCents(payment.amount), currency: 'PHP', quantity: 1, description: `${booking.nights} night(s), ${booking.totalRooms} room(s)` }],
          payment_method_types: ['gcash', 'paymaya', 'card'],
          reference_number: payment.paymentReference,
          description: `Booking ${booking.bookingReference}`,
          success_url: successUrl,
          cancel_url: cancelUrl,
          send_email_receipt: false,
          show_description: true,
          show_line_items: true,
          billing: { name: `${booking.guestFirstName} ${booking.guestLastName}`, email: booking.guestEmail, ...(booking.guestPhone ? { phone: booking.guestPhone } : {}) },
          metadata: { booking_id: String(booking.id), payment_reference: payment.paymentReference },
        },
      },
    });
    return { sessionId: data.data.id, checkoutUrl: data.data.attributes.checkout_url };
  },

  /** Verify `Paymongo-Signature: t=<ts>,te=<test sig>,li=<live sig>` = HMAC-SHA256(secret, `${t}.${rawBody}`). */
  verifyWebhook(rawBody, headers) {
    const secret = env.payments.paymongoWebhookSecret;
    if (!secret) throw new AppError(503, 'Webhook secret not configured.');
    const header = headers['paymongo-signature'] || '';
    const parts = Object.fromEntries(header.split(',').map((p) => p.trim().split('=')).filter((kv) => kv.length === 2));
    const t = Number(parts.t);
    if (!t || Math.abs(Date.now() / 1000 - t) > SIGNATURE_TOLERANCE_S) throw new AppError(400, 'Webhook timestamp invalid or too old.');
    const expected = hmacSha256(secret, `${parts.t}.${rawBody}`);
    const given = env.payments.paymongoLiveMode ? parts.li : parts.te;
    if (!given || !safeEqual(expected, given)) throw new AppError(400, 'Invalid webhook signature.');
  },

  /** Normalise a PayMongo event into { eventId, kind, ... }. */
  parseEvent(body) {
    const evt = body?.data;
    const type = evt?.attributes?.type;
    const obj = evt?.attributes?.data;
    const base = { eventId: evt?.id, eventType: type };
    if (type === 'checkout_session.payment.paid') {
      const p = obj?.attributes?.payments?.[0];
      return {
        ...base,
        kind: 'PAID',
        sessionId: obj?.id,
        paymentReference: obj?.attributes?.reference_number || obj?.attributes?.metadata?.payment_reference,
        providerPaymentId: p?.id,
        method: METHOD_MAP[p?.attributes?.source?.type] || METHOD_MAP[obj?.attributes?.payment_method_used] || 'ONLINE',
        amount: p ? p.attributes.amount / 100 : undefined,
      };
    }
    if (type === 'payment.failed') {
      return { ...base, kind: 'FAILED', paymentReference: obj?.attributes?.metadata?.payment_reference, providerPaymentId: obj?.id, reason: obj?.attributes?.last_payment_error?.failed_message || 'Payment failed' };
    }
    if (type === 'payment.refund.updated' || type === 'payment.refunded') {
      const r = obj?.attributes?.refunds?.[0] ? obj.attributes.refunds[0] : obj;
      return { ...base, kind: 'REFUND_UPDATE', providerRefundId: r?.id, refundStatus: r?.attributes?.status };
    }
    return { ...base, kind: 'IGNORED' };
  },

  async refund({ payment, amount, reason }) {
    if (!payment.providerPaymentId) throw AppError.badRequest('This payment has no provider payment id; refund it manually in the PayMongo dashboard.');
    const data = await call('POST', '/refunds', { data: { attributes: { amount: toCents(amount), payment_id: payment.providerPaymentId, reason: 'requested_by_customer', notes: String(reason || '').slice(0, 255) } } });
    const status = data.data.attributes.status;
    return { providerReference: data.data.id, status: status === 'succeeded' ? 'SUCCEEDED' : status === 'failed' ? 'FAILED' : 'PENDING' };
  },
};
