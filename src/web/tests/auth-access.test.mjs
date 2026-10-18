import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWebApp } from '../app.ts';
import { RedisAuthStore } from '../auth/store.ts';
import { txCookieName } from '../auth/routes.ts';
import { randomToken } from '../auth/store.ts';
import { createClient } from 'redis';
const url = process.env.REDIS_TEST_URL;
test(
  'expired transaction clears only its browser cookie at the login-visible scope',
  { skip: !url },
  async () => {
    const { app, store, config } = await fixture();
    try {
      const state = randomToken();
      const name = txCookieName(state, false);
      const other = txCookieName(randomToken(), false);
      const binding = randomToken();
      await store.putTransaction(state, {
        binding,
        nonce: randomToken(),
        verifier: randomToken(),
        returnTo: '/',
      });
      const redis = createClient({ url });
      await redis.connect();
      try {
        await redis.pExpire(store.key('tx', state), 1);
        await new Promise((resolve) => setTimeout(resolve, 20));
        assert.equal(await redis.exists(store.key('tx', state)), 0);
      } finally {
        await redis.close();
      }
      const response = await app.inject({
        url: '/api/auth/callback?state=' + state + '&code=expired',
        headers: { cookie: name + '=' + binding + '; ' + other + '=' + randomToken() },
      });
      assert.equal(response.headers.location, config.origin + '/?authError=login_failed');
      const cleared = response.headers['set-cookie'];
      assert.ok(cleared?.startsWith(name + '='));
      assert.match(cleared, /Path=\/api\/auth;/);
      assert.match(cleared, /Expires=Thu, 01 Jan 1970/);
      assert.ok(!cleared.includes(other));
    } finally {
      await app.close();
      await store.close();
    }
  }
);
test(
  'standalone logout-only marker is host-only secure HttpOnly and never emitted on forbidden logout',
  { skip: !url },
  async () => {
    const { app, store, config } = await fixture();
    try {
      const token = await store.createSession({ issuer: config.issuer, subject: 's', name: 'F' });
      const cookie = '__Host-bg_session=' + token;
      const session = await store.getSession(token);
      const forbidden = await app.inject({
        method: 'POST',
        url: '/api/auth/logout',
        headers: {
          cookie,
          origin: 'https://evil.test',
          'x-csrf-token': session.csrfToken,
        },
      });
      assert.equal(forbidden.statusCode, 403);
      assert.equal(forbidden.cookies.length, 0);
      const out = await app.inject({
        method: 'POST',
        url: '/api/auth/logout',
        headers: {
          cookie,
          origin: config.origin,
          'x-csrf-token': session.csrfToken,
        },
      });
      assert.equal(out.statusCode, 200);
      const marker = out.headers['set-cookie'].find((c) => c.startsWith('__Host-bg_logout='));
      assert.ok(marker);
      for (const flag of ['Secure', 'HttpOnly', 'SameSite=Lax', 'Path=/;', 'Max-Age=2592000'])
        assert.ok(marker.includes(flag), flag);
      assert.ok(!marker.includes('Domain='));
      assert.ok(!marker.includes('Partitioned'));
    } finally {
      await app.close();
      await store.close();
    }
  }
);
async function fixture(options = {}) {
  const config = {
    origin: 'https://button-gremlin.moket-home.de',
    redirectUri: 'https://button-gremlin.moket-home.de/api/auth/callback',
    issuer: 'https://fixture/',
    insecureTest: false,
    automationEnabled: false,
    automationKey: '',
    ...options,
  };
  const store = await RedisAuthStore.connect(url, randomToken());
  const oidc = {
    loginUrl: async () => 'https://identity.moket-home.de/login?return_to=fixture',
    callback: async () => ({ issuer: config.issuer, subject: 's', name: 'Fixture' }),
  };
  const runtime = { config, store, oidc };
  const app = await buildWebApp({
    client: { isReady: () => false, user: null, guilds: { cache: new Map() } },
    authRuntime: runtime,
    logger: false,
  });
  return { app, store, config };
}
test(
  'opt-in machine bearer isolated from cookie/docs/auth; rotation and disable deny',
  { skip: !url },
  async () => {
    const { app, store, config } = await fixture({
      automationEnabled: true,
      automationKey: 'fixture-machine',
    });
    try {
      assert.equal(
        (
          await app.inject({
            url: '/api/sounds',
            headers: { authorization: 'Bearer fixture-machine' },
          })
        ).statusCode,
        200
      );
      for (const path of ['/api/auth/session', '/api/auth/logout', '/docs', '/docs/json'])
        assert.equal(
          (
            await app.inject({
              url: path,
              method: path.includes('logout') ? 'POST' : 'GET',
              headers: { authorization: 'Bearer fixture-machine' },
            })
          ).statusCode,
          401
        );
      assert.equal(
        (
          await app.inject({
            url: '/api/sounds',
            headers: { authorization: 'Bearer fixture-machine', origin: 'https://evil.test' },
          })
        ).statusCode,
        403
      );
      const token = await store.createSession({ issuer: config.issuer, subject: 's', name: 'F' });
      assert.equal(
        (
          await app.inject({
            url: '/api/sounds',
            headers: {
              authorization: 'Bearer fixture-machine',
              cookie: '__Host-bg_session=' + token,
            },
          })
        ).statusCode,
        401
      );
      config.automationKey = 'rotated';
      assert.equal(
        (
          await app.inject({
            url: '/api/sounds',
            headers: { authorization: 'Bearer fixture-machine' },
          })
        ).statusCode,
        401
      );
      config.automationEnabled = false;
      assert.equal(
        (await app.inject({ url: '/api/sounds', headers: { authorization: 'Bearer rotated' } }))
          .statusCode,
        401
      );
    } finally {
      await app.close();
      await store.close();
    }
  }
);
test(
  'production cookie flags, malformed cookies/state, parallel tabs, cap and store outage',
  { skip: !url },
  async () => {
    const { app, store, config } = await fixture();
    try {
      const login = await app.inject({ url: '/api/auth/login?returnTo=%2F' });
      assert.equal(login.statusCode, 302);
      const txCookie = login.headers['set-cookie'].find((c) =>
        c.startsWith('__Secure-bg_oidc_tx_')
      );
      const browserCookie = login.headers['set-cookie'].find((c) =>
        c.startsWith('__Host-bg_browser=')
      );
      for (const flag of ['Secure', 'HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=2592000'])
        assert.ok(browserCookie.includes(flag));
      assert.ok(!browserCookie.includes('Domain='));
      for (const flag of ['Secure', 'HttpOnly', 'SameSite=Lax', 'Path=/api/auth;', 'Max-Age=600'])
        assert.ok(txCookie.includes(flag));
      assert.ok(!txCookie.includes('Domain='));
      for (const cookie of ['__Host-bg_session=%ZZ', '__Host-bg_session=a; __Host-bg_session=b'])
        assert.ok(
          [400, 401].includes(
            (await app.inject({ url: '/api/auth/session', headers: { cookie } })).statusCode
          )
        );
      for (const query of ['?state=a', '?state=a&state=b', '?state=%ZZ'])
        assert.equal((await app.inject({ url: '/api/auth/callback' + query })).statusCode, 302);
      const states = [randomToken(), randomToken()];
      const browser = randomToken();
      const browserGeneration = await store.browserGeneration(browser);
      let cookie;
      for (const state of states) {
        const tx = {
          phase: 'probe',
          browser,
          browserGeneration,
          binding: randomToken(),
          nonce: randomToken(),
          verifier: randomToken(),
          returnTo: '/?ok=1',
        };
        await store.putTransaction(state, tx);
        const response = await app.inject({
          url: '/api/auth/callback?state=' + state + '&code=fixture',
          headers: {
            cookie:
              txCookieName(state, false) + '=' + tx.binding + '; __Host-bg_browser=' + browser,
            host: 'evil.test',
          },
        });
        assert.equal(response.headers.location, config.origin + '/?ok=1');
        const set = response.headers['set-cookie'];
        cookie = set.find((v) => v.startsWith('__Host-bg_session='));
        for (const flag of ['Secure', 'HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=900'])
          assert.ok(cookie.includes(flag));
        assert.ok(!cookie.includes('Domain='));
      }
      const crowded = Array.from(
        { length: 8 },
        (_, i) => '__Secure-bg_oidc_tx_' + i + '=fixture'
      ).join('; ');
      assert.equal(
        (await app.inject({ url: '/api/auth/login', headers: { cookie: crowded } })).statusCode,
        429
      );
      await store.close();
      assert.equal(
        (await app.inject({ url: '/api/sounds', headers: { cookie: cookie.split(';')[0] } }))
          .statusCode,
        503
      );
      assert.equal(
        (await app.inject({ url: '/api/auth/session', headers: { cookie: cookie.split(';')[0] } }))
          .statusCode,
        503
      );
    } finally {
      await app.close();
      await store.close();
    }
  }
);
