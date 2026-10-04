import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWebApp } from '../app.ts';
import { RedisAuthStore } from '../auth/store.ts';
import { OidcRuntime } from '../auth/oidc.ts';
import { fakeProvider } from './fake-oidc-server.mjs';
const redis = process.env.REDIS_TEST_URL;
export const protectedRoutes = [
  ['GET', '/api/sounds'],
  ['GET', '/api/sounds/tags'],
  ['GET', '/api/sounds/fixture/stream'],
  ['POST', '/api/sounds/upload'],
  ['POST', '/api/sounds/tags'],
  ['DELETE', '/api/sounds/tags/fixture'],
  ['DELETE', '/api/sounds/fixture'],
  ['PATCH', '/api/sounds/fixture/metadata'],
  ['GET', '/api/bot/status'],
  ['POST', '/api/bot/play'],
  ['POST', '/api/bot/disconnect'],
  ['GET', '/docs'],
  ['GET', '/docs/json'],
  ['GET', '/docs/unknown'],
];
test(
  'real HTTP auth gates, broker roundtrip, CSRF, concurrent callbacks, revocation and logout',
  { skip: !redis },
  async () => {
    const p = await fakeProvider();
    const store = await RedisAuthStore.connect(redis, 'http-fixture-secret'.repeat(3));
    const config = {
      issuer: p.issuer,
      origin: 'http://127.0.0.1:3000',
      redirectUri: 'http://127.0.0.1:3000/api/auth/callback',
      brokerBase: p.issuer.slice(0, -1),
      clientId: 'bg',
      clientSecret: 'fixture',
      insecureTest: true,
      automationEnabled: false,
      automationKey: '',
    };
    const oidc = await OidcRuntime.create(config);
    const app = await buildWebApp({
      client: { user: null, guilds: { cache: new Map() } },
      authRuntime: { config, store, oidc },
      logger: false,
    });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const base = app.listeningOrigin;
    const req = (path, options = {}) => fetch(base + path, { redirect: 'manual', ...options });
    const cookieOf = (r) =>
      r.headers
        .getSetCookie()
        .filter((v) => v.includes('=') && !v.includes('Max-Age=0'))
        .map((v) => v.split(';')[0])
        .join('; ');
    async function start() {
      const r = await req('/api/auth/login?returnTo=%2F');
      assert.equal(r.status, 302);
      let q = await fetch(r.headers.get('location'), { redirect: 'manual' });
      q = await fetch(new URL(q.headers.get('location'), p.issuer), { redirect: 'manual' });
      return { callback: new URL(q.headers.get('location')), binding: cookieOf(r) };
    }
    try {
      for (const [method, path] of protectedRoutes) {
        const r = await req(path, { method });
        assert.equal(r.status, 401, method + ' ' + path);
      }
      assert.equal((await req('/api/auth/verify', { method: 'POST' })).status, 404);
      assert.equal((await req('/api/auth/unknown')).status, 404);
      assert.equal((await req('/api/auth/session')).headers.get('cache-control'), 'no-store');
      assert.deepEqual(await (await req('/api/auth/session')).json(), { authenticated: false });
      const tx = await start();
      assert.match(tx.binding, /bg_oidc_tx_/);
      let r = await req(tx.callback.pathname + tx.callback.search, {
        headers: { Cookie: tx.binding.replace(/=.*/, '=wrong') },
      });
      assert.equal(r.status, 302);
      assert.match(r.headers.get('location'), /authError/);
      const callbacks = await Promise.all([
        req(tx.callback.pathname + tx.callback.search, { headers: { Cookie: tx.binding } }),
        req(tx.callback.pathname + tx.callback.search, { headers: { Cookie: tx.binding } }),
      ]);
      const success = callbacks.find((r) => r.headers.get('location') === config.origin + '/');
      assert.ok(success);
      assert.equal(
        callbacks.filter((r) => r.headers.get('location') === config.origin + '/').length,
        1
      );
      assert.equal(
        callbacks.filter((r) => r.headers.get('location')?.includes('authError=login_failed'))
          .length,
        1
      );
      for (const response of callbacks) {
        const cleared = response.headers
          .getSetCookie()
          .find((c) => c.startsWith(tx.binding.split('=')[0] + '='));
        assert.match(cleared, /Path=\/api\/auth;/);
        assert.match(cleared, /Expires=Thu, 01 Jan 1970/);
      }
      const cookie = cookieOf(success);
      assert.match(cookie, /bg_session=/);
      const session = await (
        await req('/api/auth/session', { headers: { Cookie: cookie } })
      ).json();
      assert.equal(session.authenticated, true);
      assert.equal(session.identity.subject, 'fixture-user');
      assert.ok(!JSON.stringify(session).includes('TOKEN'));
      assert.equal((await req('/api/sounds', { headers: { Cookie: cookie } })).status, 200);
      for (const headers of [
        { Cookie: cookie },
        { Cookie: cookie, Origin: 'https://evil.test', 'X-CSRF-Token': session.csrfToken },
        { Cookie: cookie, Origin: config.origin, 'X-CSRF-Token': 'wrong' },
        {
          Cookie: cookie,
          Authorization: 'Bearer bad',
          Origin: config.origin,
          'X-CSRF-Token': session.csrfToken,
        },
      ])
        assert.ok(
          [401, 403].includes((await req('/api/sounds/tags', { method: 'POST', headers })).status)
        );
      assert.equal(
        (
          await req('/api/auth/logout', {
            method: 'POST',
            headers: { Cookie: cookie, Origin: config.origin, 'X-CSRF-Token': session.csrfToken },
          })
        ).status,
        200
      );
      assert.equal((await req('/api/sounds', { headers: { Cookie: cookie } })).status, 401);
      const tx2 = await start();
      r = await req(tx2.callback.pathname + tx2.callback.search, {
        headers: { Cookie: tx2.binding },
      });
      const cookie2 = cookieOf(r);
      await store.revokeSubject(p.issuer, 'fixture-user');
      assert.equal((await req('/api/sounds', { headers: { Cookie: cookie2 } })).status, 401);
      p.setMode('denied');
      const denial = await start();
      r = await req(denial.callback.pathname + denial.callback.search, {
        headers: { Cookie: denial.binding },
      });
      assert.match(r.headers.get('location'), /authError/);
      assert.ok(!cookieOf(r).includes('session='));
      const preflight = await req('/api/sounds', {
        method: 'OPTIONS',
        headers: { Origin: 'https://evil.test', 'Access-Control-Request-Method': 'GET' },
      });
      assert.equal(preflight.headers.get('access-control-allow-origin'), null);
    } finally {
      await app.close();
      await store.close();
      await p.close();
    }
  }
);
