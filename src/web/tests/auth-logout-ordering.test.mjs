import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWebApp } from '../app.ts';
import { RedisAuthStore, randomToken } from '../auth/store.ts';
import { OidcRuntime } from '../auth/oidc.ts';
import { fakeProvider } from './fake-oidc-server.mjs';

// A browser retains unrelated cookies and honors deletion. In particular, delivering
// an old response must NOT throw away cookies installed by the logout response.
function apply(jar, response) {
  const values = new Map(
    jar
      .split('; ')
      .filter(Boolean)
      .map((s) => {
        const i = s.indexOf('=');
        return [s.slice(0, i), s.slice(i + 1)];
      })
  );
  for (const c of response.cookies) {
    if (!c.value || c.maxAge === 0) values.delete(c.name);
    else values.set(c.name, c.value);
  }
  return [...values].map(([k, v]) => `${k}=${v}`).join('; ');
}
async function fixture() {
  assert.ok(process.env.REDIS_TEST_URL, 'real disposable Redis required; do not silently skip');
  const p = await fakeProvider();
  const secret = randomToken();
  const store = await RedisAuthStore.connect(process.env.REDIS_TEST_URL, secret);
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
  const start = (cookie = '', explicit = false, headers = {}) =>
    app.inject({
      url: '/api/auth/login?returnTo=%2F%3Fview%3Dmine' + (explicit ? '&explicit=1' : ''),
      headers: { cookie, ...(explicit ? { 'sec-fetch-site': 'same-origin' } : {}), ...headers },
    });
  const code = async (entry) =>
    new URL((await fetch(entry.headers.location, { redirect: 'manual' })).headers.get('location'));
  const callback = (url, cookie) =>
    app.inject({ url: '/api/auth/callback' + url.search, headers: { cookie } });
  const session = async (cookie) =>
    (await app.inject({ url: '/api/auth/session', headers: { cookie } })).json();
  const login = async (jar = '', explicit = false) => {
    const entry = await start(jar, explicit);
    assert.equal(new URL(entry.headers.location).pathname, '/authorize');
    jar = apply(jar, entry);
    const success = await callback(await code(entry), jar);
    assert.equal(success.headers.location, config.origin + '/?view=mine');
    return apply(jar, success);
  };
  const logout = async (jar) => {
    const s = await session(jar);
    assert.equal(s.authenticated, true);
    const r = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: {
        cookie: jar,
        origin: config.origin,
        'x-csrf-token': s.csrfToken,
      },
    });
    assert.equal(r.statusCode, 200);
    return { r, jar: apply(jar, r) };
  };
  const denied = async (jar) => {
    assert.equal(
      (await session(jar)).authenticated,
      false,
      'logout must survive initially cookieless delayed entry'
    );
    for (const url of ['/api/sounds', '/api/bot/status', '/docs/json'])
      assert.equal((await app.inject({ url, headers: { cookie: jar } })).statusCode, 401, url);
  };
  return {
    p,
    store,
    secret,
    config,
    app,
    oidc,
    start,
    code,
    callback,
    session,
    login,
    logout,
    denied,
    close: async () => {
      await app.close();
      await store.close();
      await p.close();
    },
  };
}

for (const explicitOld of [false, true]) {
  test(`BG-G1 saved unseen entry after logout (old explicit=${explicitOld})`, async () => {
    const f = await fixture();
    try {
      const b = await f.start('', explicitOld); // withhold its headers
      const a = await f.login();
      const otherBrowser = await f.login(); // independent valid same-subject session
      const out = await f.logout(a);
      const jar = apply(out.jar, b); // old headers overwrite browser, not logout marker
      const before = f.p.requests.token;
      const late = await f.callback(await f.code(b), jar);
      await f.denied(apply(jar, late));
      assert.equal(late.headers.location, f.config.origin + '/?authError=login_failed');
      assert.equal(f.p.requests.token, before, 'suppressed callback must not exchange code');
      assert.equal(
        (await f.session(otherBrowser)).authenticated,
        true,
        'no subject-wide local logout'
      );
      const cold = await f.start(apply(jar, late));
      assert.equal(cold.headers.location, f.config.origin + '/?loggedOut=1');
      assert.equal(cold.cookies.length, 0, 'automatic entry cannot overwrite the barrier');
      const fresh = await f.login(apply(jar, late), true);
      assert.equal((await f.session(fresh)).authenticated, true);
      assert.equal((await f.start(fresh)).headers.location, f.config.origin + '/?view=mine');
      // Once explicitly reenabled, expired local sessions can warm-SSO automatically.
      const noSession = fresh
        .split('; ')
        .filter((v) => !v.startsWith('bg_session='))
        .join('; ');
      assert.equal(new URL((await f.start(noSession)).headers.location).pathname, '/authorize');
    } finally {
      await f.close();
    }
  });
}

test('delayed success and in-flight unseen exchange cannot restore backend access after logout', async () => {
  for (const ordering of ['success-headers', 'token-flight']) {
    const f = await fixture();
    let release;
    try {
      const b = await f.start();
      const bJar = apply('', b);
      let late;
      const a = await f.login();
      if (ordering === 'success-headers') late = await f.callback(await f.code(b), bJar);
      else {
        const cb = await f.code(b);
        const count = f.p.requests.token;
        release = f.p.pauseToken();
        late = Promise.resolve(f.callback(cb, bJar));
        for (let i = 0; i < 200 && f.p.requests.token === count; i++)
          await new Promise((r) => setTimeout(r, 5));
        assert.equal(f.p.requests.token, count + 1);
      }
      const out = await f.logout(a);
      release?.();
      const result = await late;
      assert.ok(
        result.cookies.some((c) => c.name === 'bg_session' && c.value),
        'exercise actual delayed success'
      );
      await f.denied(apply(apply(out.jar, b), result));
      assert.equal(
        (await f.start(apply(apply(out.jar, b), result))).headers.location,
        f.config.origin + '/?loggedOut=1'
      );
    } finally {
      release?.();
      await f.close();
    }
  }
});

test('old login_required cannot reach broker after logout; explicit intent is exact and same-origin', async () => {
  const f = await fixture();
  try {
    const b = await f.start();
    const out = await f.logout(await f.login());
    const jar = apply(out.jar, b);
    const cb = new URL(f.config.redirectUri);
    cb.searchParams.set('state', new URL(b.headers.location).searchParams.get('state'));
    cb.searchParams.set('error', 'login_required');
    assert.match((await f.callback(cb, jar)).headers.location, /authError/);
    assert.equal(f.p.requests.broker, 0);
    for (const site of ['cross-site', 'same-site', 'none', '']) {
      const r = await f.start(jar, true, { 'sec-fetch-site': site });
      assert.equal(r.statusCode, 403);
      assert.equal(r.cookies.length, 0);
    }
    for (const q of ['explicit=0', 'explicit=1&explicit=1', 'explicit=true']) {
      const r = await f.app.inject({
        url: '/api/auth/login?' + q,
        headers: { cookie: jar, 'sec-fetch-site': 'same-origin' },
      });
      assert.equal(r.statusCode, 400);
    }
    await f.denied(jar);
  } finally {
    await f.close();
  }
});

test('resumption requires completed explicit authentication and survives app/store-client replacement', async () => {
  const f = await fixture();
  const workerStore = await RedisAuthStore.connect(process.env.REDIS_TEST_URL, f.secret);
  let workerApp;
  try {
    const out = await f.logout(await f.login());
    const marker = out.r.cookies.find((c) => c.name === 'bg_logout').value;
    assert.equal(await workerStore.resumedAfterLogout(marker), false);
    const failed = await f.start(out.jar, true);
    f.p.setMode('denied');
    assert.match(
      (await f.callback(await f.code(failed), apply(out.jar, failed))).headers.location,
      /authError/
    );
    assert.equal(await workerStore.resumedAfterLogout(marker), false);
    assert.match((await f.start(out.jar)).headers.location, /loggedOut/);
    f.p.setMode('success');
    const fresh = await f.login(out.jar, true);
    assert.equal(await workerStore.resumedAfterLogout(marker), true);
    workerApp = await buildWebApp({
      client: { user: null, guilds: { cache: new Map() } },
      authRuntime: { config: f.config, store: workerStore, oidc: f.oidc },
      logger: false,
    });
    const noSession = fresh
      .split('; ')
      .filter((v) => !v.startsWith('bg_session='))
      .join('; ');
    const entry = await workerApp.inject({
      url: '/api/auth/login',
      headers: { cookie: noSession },
    });
    assert.equal(new URL(entry.headers.location).pathname, '/authorize');
    assert.ok(!entry.cookies.some((c) => c.name === 'bg_logout'));
    const success = await workerApp.inject({
      url: '/api/auth/callback' + (await f.code(entry)).search,
      headers: { cookie: apply(noSession, entry) },
    });
    assert.equal(success.headers.location, f.config.origin + '/');
    assert.equal((await f.session(apply(apply(noSession, entry), success))).authenticated, true);
    await workerStore.close();
    assert.equal(
      (await workerApp.inject({ url: '/api/auth/login', headers: { cookie: noSession } }))
        .statusCode,
      503
    );
    assert.equal(
      (await workerApp.inject({ url: '/api/auth/session', headers: { cookie: fresh } })).statusCode,
      503
    );
  } finally {
    await workerApp?.close();
    await workerStore.close();
    await f.close();
  }
});

test('a second logout survives delayed success from an earlier explicit reenable', async () => {
  const f = await fixture();
  try {
    const out = await f.logout(await f.login());
    const pending = await f.start(out.jar, true);
    const pendingJar = apply(out.jar, pending);
    const success = await f.callback(await f.code(pending), pendingJar); // withhold success headers
    const signedIn = await f.login(out.jar, true);
    const secondOut = await f.logout(signedIn);
    await f.denied(apply(apply(secondOut.jar, pending), success));
    const fresh = await f.login(secondOut.jar, true);
    assert.equal((await f.session(fresh)).authenticated, true);
  } finally {
    await f.close();
  }
});
