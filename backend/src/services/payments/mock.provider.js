/**
 * MOCK provider — development/demo only (refused in production by config/env.js).
 * Simulates a hosted checkout page (frontend/mock-checkout.html). When the tester clicks
 * "Pay" or "Fail", the server builds a webhook event, signs it with MOCK_WEBHOOK_SECRET and
 * pushes it through the exact same verifyWebhook → handleWebhook path a real provider uses.
 */
const env = require('../../config/env');
const AppError = require('../../utils/AppError');
const { hmacSha256, safeEqual, randomToken } = require('../../utils/crypto');

const SIGNATURE_TOLERANCE_S = 300;

function sign(rawBody, t = Math.floor(Date.now() / 1000)) {
  return `t=${t},v1=${hmacSha256(env.payments.mockWebhookSecret, `${t}.${rawBody}`)}`;
}

module.exports = {
  name: 'MOCK',
  sign,

  async createCheckout({ payment }) {
    const sessionId = `mock_cs_${randomToken(12)}`;
    return { sessionId, checkoutUrl: `${env.appUrl}/mock-checkout.html?session=${sessionId}&ref=${encodeURIComponent(payment.paymentReference)}` };
  },

  verifyWebhook(rawBody, headers) {
    const header = headers['x-mock-signature'] || '';
    const parts = Object.fromEntries(header.split(',').map((p) => p.trim().split('=')).filter((kv) => kv.length === 2));
    const t = Number(parts.t);
    if (!t || Math.abs(Date.now() / 1000 - t) > SIGNATURE_TOLERANCE_S) throw new AppError(400, 'Webhook timestamp invalid or too old.');
    if (!safeEqual(hmacSha256(env.payments.mockWebhookSecret, `${parts.t}.${rawBody}`), parts.v1)) throw new AppError(400, 'Invalid webhook signature.');
  },

  parseEvent(body) {
    const base = { eventId: body?.id, eventType: body?.type };
    if (body?.type === 'checkout.paid') return { ...base, kind: 'PAID', sessionId: body.data.session_id, providerPaymentId: body.data.payment_id, method: body.data.method, amount: body.data.amount };
    if (body?.type === 'checkout.failed') return { ...base, kind: 'FAILED', sessionId: body.data.session_id, reason: body.data.reason || 'Payment declined' };
    return { ...base, kind: 'IGNORED' };
  },

  async refund() {
    return { providerReference: `mock_rf_${randomToken(8)}`, status: 'SUCCEEDED' };
  },

  /** Build a signed webhook request for a mock checkout outcome. */
  buildEvent({ sessionId, outcome, method, amount }) {
    const body = {
      id: `mock_evt_${randomToken(10)}`,
      type: outcome === 'paid' ? 'checkout.paid' : 'checkout.failed',
      data: outcome === 'paid' ? { session_id: sessionId, payment_id: `mock_pay_${randomToken(8)}`, method, amount } : { session_id: sessionId, reason: 'Declined by tester' },
    };
    const raw = JSON.stringify(body);
    return { raw, headers: { 'x-mock-signature': sign(raw) } };
  },
};
