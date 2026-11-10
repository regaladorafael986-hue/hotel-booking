const { z } = require('zod');

const trimmed = (max, min = 1, label = 'This field') =>
  z.string({ required_error: `${label} is required.`, invalid_type_error: `${label} must be text.` })
    .trim()
    .min(min, min === 1 ? `${label} is required.` : `${label} must be at least ${min} characters.`)
    .max(max, `${label} must be at most ${max} characters.`);

const optionalText = (max) => z.string().trim().max(max, `Must be at most ${max} characters.`).optional().nullable().or(z.literal(''));

const email = z.string({ required_error: 'Email is required.' }).trim().toLowerCase().email('Enter a valid email address.').max(191);
const phone = z.string().trim().regex(/^[+\d][\d\s()-]{6,24}$/, 'Enter a valid phone number.').optional().nullable().or(z.literal(''));
const password = z.string({ required_error: 'Password is required.' })
  .min(8, 'Password must be at least 8 characters.')
  .max(128, 'Password is too long.')
  .regex(/[A-Za-z]/, 'Password must contain at least one letter.')
  .regex(/\d/, 'Password must contain at least one number.');

const isoDate = (label = 'Date') => z.string({ required_error: `${label} is required.` }).regex(/^\d{4}-\d{2}-\d{2}$/, `${label} must be YYYY-MM-DD.`);
const id = z.coerce.number().int().positive();
const idParams = z.object({ id }).passthrough();
// Amounts are rounded to centavos; the server never trusts more precision than the DB stores.
const money = z.coerce.number({ invalid_type_error: 'Must be a number.' }).finite('Must be a number.').min(0, 'Must be zero or more.').max(9999999999, 'Amount is too large.')
  .transform((n) => Math.round(n * 100) / 100);
const bool = z.union([z.boolean(), z.enum(['true', 'false', '1', '0'])]).transform((v) => v === true || v === 'true' || v === '1');
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time must be HH:MM (24-hour).');

module.exports = { z, trimmed, optionalText, email, phone, password, isoDate, id, idParams, money, bool, time };
