const { z, trimmed, email, phone, password } = require('./common');

const register = z.object({
  first_name: trimmed(80, 1, 'First name'),
  last_name: trimmed(80, 1, 'Last name'),
  email,
  phone,
  password,
  confirm_password: z.string().optional(),
}).refine((d) => d.confirm_password === undefined || d.confirm_password === d.password, { message: 'Passwords do not match.', path: ['confirm_password'] });

const login = z.object({ email, password: z.string().min(1, 'Password is required.').max(128) });
const forgot = z.object({ email });
const reset = z.object({ token: z.string().min(10, 'Invalid reset link.').max(200), password });
const verify = z.object({ token: z.string().min(10, 'Invalid verification link.').max(200) });
const profile = z.object({ first_name: trimmed(80, 1, 'First name').optional(), last_name: trimmed(80, 1, 'Last name').optional(), phone });
const changePassword = z.object({ current_password: z.string().min(1, 'Current password is required.'), new_password: password })
  .refine((d) => d.current_password !== d.new_password, { message: 'New password must be different from the current one.', path: ['new_password'] });

module.exports = { register, login, forgot, reset, verify, profile, changePassword };
