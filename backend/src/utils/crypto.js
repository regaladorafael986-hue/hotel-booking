const crypto = require('crypto');

const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('hex');
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const hmacSha256 = (secret, s) => crypto.createHmac('sha256', secret).update(s).digest('hex');
function safeEqual(a, b) {
  const ba = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}
// Unambiguous alphabet (no 0/O/1/I) for human-readable references.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function randomCode(len) {
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}
module.exports = { randomToken, sha256, hmacSha256, safeEqual, randomCode };
