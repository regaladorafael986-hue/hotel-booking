const auth = require('../services/auth.service');
const { ensureCsrfToken } = require('../middleware/csrf');
const env = require('../config/env');

/** Regenerate the session id on privilege change (prevents session fixation) and keep a fresh CSRF token. */
function startSession(req, user) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.userId = user.id;
      req.session.role = user.role;
      const csrf = ensureCsrfToken(req);
      req.session.save((e) => (e ? reject(e) : resolve(csrf)));
    });
  });
}

module.exports = {
  csrf(req, res) {
    const token = ensureCsrfToken(req);
    res.json({ csrf_token: token });
  },

  async register(req, res) {
    const user = await auth.register(req, req.body);
    const csrf = await startSession(req, user);
    res.status(201).json({
      user: auth.toPublicUser(user),
      csrf_token: csrf,
      message: env.brevo.apiKey ? 'Account created. Check your inbox to verify your email.' : 'Account created. (Development mode: the verification link was printed in the server console.)',
    });
  },

  async login(req, res) {
    const user = await auth.login(req, req.body);
    const csrf = await startSession(req, user);
    res.json({ user: auth.toPublicUser(user), csrf_token: csrf });
  },

  logout(req, res, next) {
    req.session.destroy((err) => {
      if (err) return next(err);
      res.clearCookie('stayease.sid', { path: '/' });
      res.json({ message: 'Logged out.' });
    });
  },

  me(req, res) {
    res.json({ user: req.user ? auth.toPublicUser(req.user) : null });
  },

  async verifyEmail(req, res) {
    const user = await auth.verifyEmail(req.body.token);
    res.json({ message: 'Your email has been verified.', user: auth.toPublicUser({ ...user, emailVerifiedAt: user.emailVerifiedAt || new Date() }) });
  },

  async resendVerification(req, res) {
    await auth.resendVerification(req.user);
    res.json({ message: 'Verification email sent.' });
  },

  async forgotPassword(req, res) {
    await auth.forgotPassword(req.body.email);
    res.json({ message: 'If an account exists for that email, a password reset link has been sent.' });
  },

  async resetPassword(req, res) {
    await auth.resetPassword(req, req.body.token, req.body.password);
    res.json({ message: 'Your password has been reset. You can now log in.' });
  },

  async updateProfile(req, res) {
    const user = await auth.updateProfile(req.user, req.body);
    res.json({ user: auth.toPublicUser(user), message: 'Profile updated.' });
  },

  async changePassword(req, res) {
    await auth.changePassword(req, req.body);
    res.json({ message: 'Password changed. Other sessions have been signed out.' });
  },
};
