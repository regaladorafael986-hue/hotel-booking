const payments = require('../services/payment.service');

module.exports = {
  async checkout(req, res) {
    res.status(201).json(await payments.createCheckout(req, req.body.booking_id));
  },

  /** Provider → server. Body is the raw Buffer (signature is computed over exact bytes). */
  async webhook(req, res) {
    const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
    const headers = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k.toLowerCase(), Array.isArray(v) ? v[0] : v]));
    const result = await payments.handleWebhook(raw, headers);
    res.json(result);
  },

  async get(req, res) {
    res.json({ payment: await payments.getById(req.user, req.params.id) });
  },

  async refund(req, res) {
    res.status(201).json({ refund: await payments.refundPayment(req, req.params.id, req.body), message: 'Refund submitted.' });
  },

  async mockSession(req, res) {
    res.json(await payments.mockSession(req.user, req.params.sessionId));
  },

  async mockComplete(req, res) {
    res.json(await payments.mockComplete(req.user, req.params.sessionId, req.body));
  },
};
