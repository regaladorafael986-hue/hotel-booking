// All money math is done in integer centavos to avoid floating-point drift,
// then converted back to a 2-decimal string for Prisma DECIMAL columns.
const toCents = (v) => {
  if (v === null || v === undefined) return 0;
  const s = typeof v === 'object' && typeof v.toFixed === 'function' ? v.toFixed(2) : Number(v).toFixed(2);
  return Math.round(Number(s) * 100);
};
const fromCents = (c) => (Math.round(c) / 100).toFixed(2);
const toNumber = (v) => (v === null || v === undefined ? null : Number(typeof v === 'object' ? v.toString() : v));
/** Human-readable peso amount from centavos, e.g. ₱3,256.00 (for messages). */
const pesoCents = (c) => `₱${(Math.round(c) / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
module.exports = { toCents, fromCents, toNumber, pesoCents };
