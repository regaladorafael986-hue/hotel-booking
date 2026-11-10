// Social sign-in tests. Provider HTTP calls (token + profile) are stubbed; everything else is the real app.
process.env.GOOGLE_CLIENT_ID = 'test-google-id';
process.env.GOOGLE_CLIENT_SECRET = 'test-google-secret';
process.env.FACEBOOK_APP_ID = 'test-fb-id';
process.env.FACEBOOK_APP_SECRET = 'test-fb-secret';

const { test, before, after, describe, mock } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

let app;
let profiles = {}; // what the stubbed provider returns for the next callback
const realFetch = globalThis.fetch;

before(async () => {
  await h.reset();
  app = h.createApp();
  mock.method(globalThis, 'fetch', async (url) => {
    const u = String(url);
    const json = (data) => ({ ok: true, status: 200, json: async () => data });
    if (u.startsWith('https://oauth2.googleapis.com/token')) return json({ access_token: 'g-token' });
    if (u.startsWith('https://openidconnect.googleapis.com/v1/userinfo')) return json(profiles.google);
    if (u.includes('graph.facebook.com') && u.includes('/oauth/access_token')) return json({ access_token: 'fb-token' });
    if (u.includes('graph.facebook.com') && u.includes('/me?')) return json(profiles.facebook);
    return realFetch(url);
  });
});
after(async () => { mock.restoreAll(); await h.prisma().$disconnect(); });

/** Start the flow with an agent and return { agent, state, location }. */
async function startFlow(provider, agent = h.request.agent(app), query = '') {
  const res = await agent.get(`/api/v1/auth/oauth/${provider}/start${query}`);
  assert.equal(res.status, 302, JSON.stringify(res.headers));
  const loc = new URL(res.headers.location);
  return { agent, state: loc.searchParams.get('state'), location: loc };
}
const finish = (agent, provider, state, code = 'auth-code') => agent.get(`/api/v1/auth/oauth/${provider}/callback?code=${code}&state=${state}`);
const errorOf = (res) => new URL(res.headers.location, 'http://x').searchParams.get('oauth_error');

describe('social sign-in', () => {
  test('lists configured providers', async () => {
    const r = await h.request(app).get('/api/v1/auth/providers');
    assert.deepEqual(r.body.items.map((p) => [p.id, p.enabled]), [['google', true], ['facebook', true]]);
  });

  test('Google start uses state + PKCE and the correct redirect URI', async () => {
    const { state, location } = await startFlow('google');
    assert.equal(location.host, 'accounts.google.com');
    assert.ok(state && state.length >= 32);
    assert.equal(location.searchParams.get('code_challenge_method'), 'S256');
    assert.match(location.searchParams.get('redirect_uri'), /\/api\/v1\/auth\/oauth\/google\/callback$/);
  });

  test('forged or replayed state is rejected', async () => {
    profiles.google = { sub: 'g-x', email: 'x@test.dev', email_verified: true, given_name: 'X' };
    const { agent, state } = await startFlow('google');
    const bad = await finish(agent, 'google', 'not-the-state');
    assert.match(bad.headers.location, /^\/login\.html\?oauth_error=/);
    const replay = await finish(agent, 'google', state); // state was consumed by the failed attempt
    assert.match(errorOf(replay), /expired or is invalid/);
  });

  test('new Google user is created verified, logged in, with no password', async () => {
    profiles.google = { sub: 'g-100', email: 'New.Guest@Test.dev', email_verified: true, given_name: 'New', family_name: 'Guest' };
    const { agent, state } = await startFlow('google', undefined, '?next=/rooms.html');
    const res = await finish(agent, 'google', state);
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/rooms.html');
    const me = (await agent.get('/api/v1/auth/me')).body.user;
    assert.equal(me.email, 'new.guest@test.dev');
    assert.equal(me.email_verified, true);
    assert.equal(me.has_password, false);
    assert.deepEqual(me.linked_providers.map((p) => p.provider), ['google']);

    // Signing in again with the same Google account reuses the user.
    const again = await startFlow('google');
    await finish(again.agent, 'google', again.state);
    assert.equal(await h.prisma().user.count({ where: { email: 'new.guest@test.dev' } }), 1);
  });

  test('social-only account: password login fails, can set a password, cannot remove its only sign-in', async () => {
    const user = await h.prisma().user.findUnique({ where: { email: 'new.guest@test.dev' } });
    const agent = h.request.agent(app);
    const t = await h.csrf(agent);
    const pwLogin = await agent.post('/api/v1/auth/login').set('x-csrf-token', t).send({ email: user.email, password: 'whatever123' });
    assert.equal(pwLogin.status, 401);

    const { agent: a, state } = await startFlow('google');
    profiles.google = { sub: 'g-100', email: user.email, email_verified: true, given_name: 'New' };
    await finish(a, 'google', state);
    const token = (await a.get('/api/v1/auth/csrf')).body.csrf_token;
    const unlink = await a.delete('/api/v1/auth/oauth/google').set('x-csrf-token', token);
    assert.equal(unlink.status, 409);
    const setPw = await a.put('/api/v1/auth/password').set('x-csrf-token', token).send({ new_password: 'NewPassw0rd' });
    assert.equal(setPw.status, 200, JSON.stringify(setPw.body));
    assert.equal((await a.get('/api/v1/auth/me')).body.user.has_password, true);
    const unlink2 = await a.delete('/api/v1/auth/oauth/google').set('x-csrf-token', token);
    assert.equal(unlink2.status, 200);
  });

  test('existing account is linked only on a provider-verified email', async () => {
    const existing = await h.makeUser('CUSTOMER');
    // Facebook does not assert verification → no automatic linking.
    profiles.facebook = { id: 'fb-1', email: existing.email, first_name: 'Fb' };
    const fb = await startFlow('facebook');
    assert.equal(fb.location.host, 'www.facebook.com');
    const r1 = await finish(fb.agent, 'facebook', fb.state);
    assert.match(errorOf(r1), /already exists/);
    assert.equal(await h.prisma().oAuthAccount.count({ where: { userId: existing.id } }), 0);
    // Google with email_verified → linked and signed in as the existing user.
    profiles.google = { sub: 'g-200', email: existing.email, email_verified: true, given_name: 'G' };
    const g = await startFlow('google');
    await finish(g.agent, 'google', g.state);
    assert.equal((await g.agent.get('/api/v1/auth/me')).body.user.id, existing.id);
  });

  test('new Facebook user is created unverified (verification email sent)', async () => {
    profiles.facebook = { id: 'fb-2', email: 'fbnew@test.dev', first_name: 'Fiona', last_name: 'Book' };
    const { agent, state } = await startFlow('facebook');
    await finish(agent, 'facebook', state);
    const me = (await agent.get('/api/v1/auth/me')).body.user;
    assert.equal(me.email, 'fbnew@test.dev');
    assert.equal(me.email_verified, false);
    assert.equal(await h.prisma().authToken.count({ where: { userId: me.id, type: 'EMAIL_VERIFICATION' } }), 1);
  });

  test('staff accounts cannot use social sign-in; missing email is rejected', async () => {
    const staff = await h.makeUser('RECEPTIONIST');
    profiles.google = { sub: 'g-300', email: staff.email, email_verified: true, given_name: 'S' };
    const g = await startFlow('google');
    const r = await finish(g.agent, 'google', g.state);
    assert.match(errorOf(r), /Staff accounts/);
    assert.equal((await g.agent.get('/api/v1/auth/me')).body.user, null);

    profiles.facebook = { id: 'fb-3', first_name: 'NoMail' };
    const f = await startFlow('facebook');
    assert.match(errorOf(await finish(f.agent, 'facebook', f.state)), /did not share an email/);
  });

  test('a logged-in customer can connect a provider from their profile', async () => {
    const user = await h.makeUser('CUSTOMER');
    const c = await h.login(app, user);
    profiles.facebook = { id: 'fb-9', email: 'other-address@test.dev', first_name: 'Link' };
    const { state } = await startFlow('facebook', c.agent, '?mode=link');
    const res = await finish(c.agent, 'facebook', state);
    assert.equal(res.headers.location, '/customer/profile.html?linked=facebook');
    const links = await h.prisma().oAuthAccount.findMany({ where: { userId: user.id } });
    assert.deepEqual(links.map((l) => l.provider), ['facebook']);
  });

  test('open redirects via ?next are ignored', async () => {
    profiles.google = { sub: 'g-500', email: 'safe@test.dev', email_verified: true, given_name: 'Safe' };
    const { agent, state } = await startFlow('google', undefined, `?next=${encodeURIComponent('//evil.example/x')}`);
    const res = await finish(agent, 'google', state);
    assert.ok(res.headers.location.startsWith('/customer/'), res.headers.location);
  });
});
