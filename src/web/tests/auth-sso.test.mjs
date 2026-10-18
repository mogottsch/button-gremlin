import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWebApp } from '../app.ts';
import { RedisAuthStore, randomToken } from '../auth/store.ts';
import { OidcRuntime } from '../auth/oidc.ts';
import { fakeProvider } from './fake-oidc-server.mjs';
import { createClient } from 'redis';
const redis = process.env.REDIS_TEST_URL;
test(
  'a probe returning after another tab signs in reuses local session instead of broker',
  { skip: !redis },
  async () => {
    const f = await fixture();
    try {
      const pending = await f.start();
      const token = await f.store.createSession({
        issuer: f.p.issuer,
        subject: 'local',
        name: 'Local',
      });
      const cb = new URL(f.config.redirectUri);
      cb.searchParams.set('state', pending.url.searchParams.get('state'));
      cb.searchParams.set('error', 'login_required');
      const result = await f.callback(cb, merge(pending.cookie, 'bg_session=' + token));
      assert.equal(result.headers.location, f.config.origin + '/?view=mine');
      assert.equal(f.p.requests.broker, 0);
      assert.ok(!cookies(result).includes('bg_session='));
    } finally {
      await f.close();
    }
  }
);
const cookies = (r) =>
  r.cookies
    .filter((c) => c.value)
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
const merge = (...values) =>
  Object.entries(
    Object.assign(
      {},
      ...values.map((v) =>
        Object.fromEntries(
          v
            .split('; ')
            .filter(Boolean)
            .map((x) => {
              const i = x.indexOf('=');
              return [x.slice(0, i), x.slice(i + 1)];
            })
        )
      )
    )
  )
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
async function fixture() {
  const p = await fakeProvider();
  const store = await RedisAuthStore.connect(redis, randomToken());
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
  const start = async (cookie = '') => {
    const r = await app.inject({
      url: '/api/auth/login?returnTo=%2F%3Fview%3Dmine',
      headers: { cookie },
    });
    return { r, cookie: merge(cookie, cookies(r)), url: new URL(r.headers.location) };
  };
  const callback = (url, cookie) =>
    app.inject({ url: '/api/auth/callback' + url.search, headers: { cookie } });
  const code = async (url) =>
    new URL((await fetch(url, { redirect: 'manual' })).headers.get('location'));
  return {
    p,
    store,
    config,
    oidc,
    app,
    start,
    callback,
    code,
    close: async () => {
      await app.close();
      await store.close();
      await p.close();
    },
  };
}
test(
  'SSO probe is direct; validated login_required alone creates fresh coherent bounded broker fallback',
  { skip: !redis },
  async () => {
    const f = await fixture();
    try {
      const a = await f.start();
      assert.equal(a.url.pathname, '/authorize');
      assert.equal(a.url.searchParams.get('prompt'), 'none');
      const error = new URL(f.config.redirectUri);
      error.searchParams.set('state', a.url.searchParams.get('state'));
      error.searchParams.set('error', 'login_required');
      const wrong = await f.callback(error, '');
      assert.match(wrong.headers.location, /authError/);
      const r = await f.callback(error, a.cookie);
      const broker = new URL(r.headers.location);
      assert.equal(broker.pathname, '/login');
      const fallback = new URL(broker.searchParams.get('return_to'), f.p.issuer);
      assert.equal(fallback.searchParams.has('prompt'), false);
      for (const key of ['state', 'nonce', 'code_challenge'])
        assert.notEqual(fallback.searchParams.get(key), a.url.searchParams.get(key));
      for (const key of ['client_id', 'redirect_uri', 'scope', 'code_challenge_method'])
        assert.equal(fallback.searchParams.get(key), a.url.searchParams.get(key));
      assert.match((await f.callback(error, a.cookie)).headers.location, /authError/);
      const cookie = merge(a.cookie, cookies(r));
      const cb = await f.code(fallback);
      const success = await f.callback(cb, cookie);
      assert.equal(success.headers.location, f.config.origin + '/?view=mine');
      assert.ok(cookies(success).includes('bg_session='));
    } finally {
      await f.close();
    }
  }
);
test(
  'local session wins; no provider/broker or transaction on warm login',
  { skip: !redis },
  async () => {
    const f = await fixture();
    try {
      const token = await f.store.createSession({
        issuer: f.p.issuer,
        subject: 'warm',
        name: 'Warm',
      });
      const a = await f.start('bg_session=' + token);
      assert.equal(a.r.headers.location, f.config.origin + '/?view=mine');
      assert.equal(a.r.cookies.length, 0);
    } finally {
      await f.close();
    }
  }
);
test(
  'denial, cancellation, ambiguous callbacks and second login_required are terminal',
  { skip: !redis },
  async () => {
    const f = await fixture();
    try {
      for (const error of [
        'access_denied',
        'consent_required',
        'server_error',
        'temporarily_unavailable',
        'unknown',
      ]) {
        const a = await f.start();
        const cb = new URL(f.config.redirectUri);
        cb.searchParams.set('state', a.url.searchParams.get('state'));
        cb.searchParams.set('error', error);
        assert.match((await f.callback(cb, a.cookie)).headers.location, /authError/);
      }
      const a = await f.start();
      const cb = new URL(f.config.redirectUri);
      cb.searchParams.set('state', a.url.searchParams.get('state'));
      cb.searchParams.set('error', 'login_required');
      cb.searchParams.set('code', 'ambiguous');
      assert.match((await f.callback(cb, a.cookie)).headers.location, /authError/);
      const b = await f.start();
      cb.searchParams.delete('code');
      cb.searchParams.set('state', b.url.searchParams.get('state'));
      const r = await f.callback(cb, b.cookie);
      const fallback = new URL(
        new URL(r.headers.location).searchParams.get('return_to'),
        f.p.issuer
      );
      cb.searchParams.set('state', fallback.searchParams.get('state'));
      assert.match(
        (await f.callback(cb, merge(b.cookie, cookies(r)))).headers.location,
        /authError/
      );
    } finally {
      await f.close();
    }
  }
);
test(
  'logout invalidates pending/late callbacks and same-browser sessions atomically across workers',
  { skip: !redis },
  async () => {
    const f = await fixture();
    try {
      const a = await f.start();
      const cb = await f.code(a.url);
      const r = await f.callback(cb, a.cookie);
      const cookie = merge(a.cookie, cookies(r));
      const session = (
        await f.app.inject({ url: '/api/auth/session', headers: { cookie } })
      ).json();
      // Start a pending transaction from an expired-session view of the same browser.
      const browserCookie = cookie
        .split('; ')
        .filter((x) => !x.startsWith('bg_session='))
        .join('; ');
      const pending = await f.start(browserCookie);
      const late = await f.code(pending.url);
      const out = await f.app.inject({
        method: 'POST',
        url: '/api/auth/logout',
        headers: { cookie, origin: f.config.origin, 'x-csrf-token': session.csrfToken },
      });
      assert.equal(out.statusCode, 200);
      assert.match((await f.callback(late, pending.cookie)).headers.location, /authError/);
      assert.equal(
        (await f.app.inject({ url: '/api/auth/session', headers: { cookie } })).json()
          .authenticated,
        false
      );
      assert.equal(out.json().returnTo, '/?loggedOut=1');
    } finally {
      await f.close();
    }
  }
);
test(
  'two reordered tabs remain browser bound; initially cookieless losers fail closed',
  { skip: !redis },
  async () => {
    const f = await fixture();
    try {
      const a = await f.start();
      const b = await f.start(a.cookie);
      const jar = merge(a.cookie, b.cookie);
      const cbB = await f.code(b.url);
      const cbA = await f.code(a.url);
      const resultB = await f.callback(cbB, jar);
      const resultA = await f.callback(cbA, jar);
      assert.ok(cookies(resultA).includes('bg_session='));
      assert.ok(cookies(resultB).includes('bg_session='));
      assert.equal(f.p.requests.broker, 0);
      const c = await f.start();
      const d = await f.start();
      const wrongJar = merge(c.cookie, d.cookie);
      assert.match((await f.callback(await f.code(c.url), wrongJar)).headers.location, /authError/);
      assert.ok(cookies(await f.callback(await f.code(d.url), wrongJar)).includes('bg_session='));
    } finally {
      await f.close();
    }
  }
);
test(
  'fixed authorization lease expires; re-establishment rechecks admission and never extends old sessions',
  { skip: !redis },
  async () => {
    const f = await fixture();
    const raw = createClient({ url: redis });
    await raw.connect();
    try {
      const a = await f.start();
      const result = await f.callback(await f.code(a.url), a.cookie);
      const cookie = merge(a.cookie, cookies(result));
      const token = result.cookies.find((c) => c.name === 'bg_session').value;
      const key = f.store.key('session', token);
      const original = JSON.parse(await raw.get(key));
      assert.ok(original.expiresAt - Date.now() <= 900000);
      assert.ok((await raw.ttl(key)) <= 900);
      await f.app.inject({ url: '/api/auth/session', headers: { cookie } });
      assert.equal(JSON.parse(await raw.get(key)).expiresAt, original.expiresAt);
      original.expiresAt = Date.now() - 1;
      await raw.set(key, JSON.stringify(original));
      assert.equal(
        (await f.app.inject({ url: '/api/sounds', headers: { cookie } })).statusCode,
        401
      );
      f.p.setMode('denied');
      const renewed = await f.start(cookie);
      assert.equal(renewed.url.searchParams.get('prompt'), 'none');
      const denial = await f.callback(await f.code(renewed.url), renewed.cookie);
      assert.match(denial.headers.location, /authError/);
      assert.ok(!cookies(denial).includes('bg_session='));
      assert.equal(f.p.requests.broker, 0);
      assert.equal(await f.store.getSession(token), null);
    } finally {
      await raw.close();
      await f.close();
    }
  }
);
test(
  'in-flight token exchange cannot resurrect logout or operator generation revocation',
  { skip: !redis },
  async () => {
    for (const action of ['logout', 'revoke']) {
      const f = await fixture();
      let release;
      try {
        const a = await f.start();
        const r = await f.callback(await f.code(a.url), a.cookie);
        const cookie = merge(a.cookie, cookies(r));
        const session = (
          await f.app.inject({ url: '/api/auth/session', headers: { cookie } })
        ).json();
        const browserCookie = cookie
          .split('; ')
          .filter((x) => !x.startsWith('bg_session='))
          .join('; ');
        const pending = await f.start(browserCookie);
        const cb = await f.code(pending.url);
        release = f.p.pauseToken();
        const count = f.p.requests.token;
        const flight = f.callback(cb, pending.cookie);
        const promise = Promise.resolve(flight);
        for (let i = 0; i < 100 && f.p.requests.token === count; i++)
          await new Promise((r) => setTimeout(r, 5));
        assert.equal(f.p.requests.token, count + 1);
        if (action === 'logout')
          assert.equal(
            (
              await f.app.inject({
                method: 'POST',
                url: '/api/auth/logout',
                headers: { cookie, origin: f.config.origin, 'x-csrf-token': session.csrfToken },
              })
            ).statusCode,
            200
          );
        else await f.store.revokeSubject(f.p.issuer, 'fixture-user');
        release();
        const done = await promise;
        assert.match(done.headers.location, /authError/);
        assert.ok(!cookies(done).includes('bg_session='));
        assert.equal(
          (await f.app.inject({ url: '/api/auth/session', headers: { cookie } })).json()
            .authenticated,
          false
        );
      } finally {
        release?.();
        await f.close();
      }
    }
  }
);
test(
  'store/provider outage terminates without broker fallback or session upsert',
  { skip: !redis },
  async () => {
    const f = await fixture();
    try {
      f.p.setMode('token-error');
      const a = await f.start();
      const result = await f.callback(await f.code(a.url), a.cookie);
      assert.match(result.headers.location, /authError/);
      assert.equal(f.p.requests.broker, 0);
      assert.ok(!cookies(result).includes('bg_session='));
      await f.store.close();
      const down = await f.start().catch(() => null);
      assert.equal(down, null);
      assert.equal((await f.app.inject({ url: '/api/auth/login' })).statusCode, 503);
    } finally {
      await f.close();
    }
  }
);
