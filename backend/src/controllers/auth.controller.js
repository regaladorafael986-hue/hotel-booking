const auth = require('../services/auth.service');
const { ensureCsrfToken } = require('../middleware/csrf');
const env = require('../config/env');
const oauth = require('../services/oauth.service');
const AppError = require('../utils/AppError');

/** Only same-site relative paths are allowed as post-login destinations (no open redirects). */
const safeNext = (n) => (typeof n === 'string' && /^\/(?!\/)[^\s\\]*$/.test(n) && !n.includes('://') && !n.startsWith('/api/') ? n : null);

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

  async me(req, res) {
    if (!req.user) return res.json({ user: null });
    res.json({ user: { ...auth.toPublicUser(req.user), linked_providers: await oauth.linkedProviders(req.user.id) } });
  },

  // ───── Social sign-in (Google / Facebook) ─────
  providers(req, res) {
    res.json({ items: oauth.listProviders() });
  },

  /** GET /auth/oauth/:provider/start?next=/path&mode=link → 302 to the provider. Errors come back to the login page. */
  oauthStart(req, res) {
    const mode = req.query.mode === 'link' ? 'link' : 'login';
    try {
      if (mode === 'link' && !req.user) throw new Error('Please log in to connect an account.');
      const url = oauth.start(req, req.params.provider, { next: safeNext(req.query.next), mode });
      req.session.save(() => res.redirect(302, url));
    } catch (err) {
      res.redirect(302, `${mode === 'link' ? '/customer/profile.html' : '/login.html'}?oauth_error=${encodeURIComponent(err.message)}`);
    }
  },

  /** GET /auth/oauth/:provider/callback — provider redirects here with ?code&state. */
  async oauthCallback(req, res) {
    const linking = req.session?.oauth?.mode === 'link';
    try {
      const r = await oauth.callback(req, req.params.provider, { code: req.query.code, state: req.query.state, error: req.query.error });
      if (r.linked) return res.redirect(302, `/customer/profile.html?linked=${encodeURIComponent(req.params.provider)}`);
      await startSession(req, r.user);
      res.redirect(302, r.next || (r.user.emailVerifiedAt ? '/customer/dashboard.html' : '/customer/dashboard.html?welcome=1'));
    } catch (err) {
      if (!(err instanceof AppError)) console.error('[oauth] callback failed', err);
      const msg = err instanceof AppError ? err.message : 'Sign-in failed. Please try again.';
      req.session.save(() => res.redirect(302, `${linking ? '/customer/profile.html' : '/login.html'}?oauth_error=${encodeURIComponent(msg)}`));
    }
  },

  async oauthUnlink(req, res) {
    await oauth.unlink(req, req.params.provider);
    res.json({ message: 'Account disconnected.' });
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
