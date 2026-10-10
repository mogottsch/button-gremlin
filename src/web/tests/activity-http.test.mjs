import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWebApp } from '../app.ts';
import { RedisAuthStore, randomToken } from '../auth/store.ts';
export const G = '111111111111111111',
  C = '222222222222222222',
  U = '333333333333333333';
export async function fixture() {
  const config = {
    origin: 'https://button-gremlin.moket-home.de',
    issuer: 'https://fixture/',
    insecureTest: false,
    automationEnabled: false,
    activity: {
      clientId: '1434488648228929629',
      origin: 'https://1434488648228929629.discordsays.com',
      clientSecret: 'SECRET',
    },
  };
  const store = await RedisAuthStore.connect(process.env.REDIS_TEST_URL, randomToken());
  const state = {
    meStatus: 200,
    expires: new Date(Date.now() + 3600000).toISOString(),
    scopes: ['identify'],
    member: true,
    voice: C,
    permissions: true,
    admin: false,
    audience: config.activity.clientId,
    token: true,
  };
  const guild = {
    id: G,
    name: 'Launch guild',
    members: {
      fetch: async ({ user }) => {
        if (!state.member) throw Error('absent');
        return { id: user, permissions: { has: () => state.admin } };
      },
    },
    voiceStates: {
      cache: new Map([
        [
          U,
          {
            get channelId() {
              return state.voice;
            },
          },
        ],
      ]),
    },
  };
  const channel = {
    id: C,
    guildId: G,
    guild,
    name: 'Launch voice',
    isVoiceBased: () => true,
    permissionsFor: () => ({ has: () => state.permissions }),
  };
  guild.channels = { fetch: async (id) => (id === C ? channel : null) };
  const client = {
    isReady: () => true,
    user: { id: '444444444444444444' },
    guilds: { cache: new Map([[G, guild]]) },
  };
  const calls = [];
  const activityFetch = async (url, init) => {
    calls.push([url, init]);
    if (url.endsWith('/oauth2/token'))
      return Response.json(
        state.token
          ? { access_token: 'TRANSIENT_TOKEN', token_type: 'Bearer', expires_in: 3600 }
          : { error: 'invalid_grant' },
        { status: state.token ? 200 : 400 }
      );
    return Response.json(
      {
        application: { id: state.audience },
        scopes: state.scopes,
        expires: state.expires,
        user: { id: U, username: 'Verified user' },
      },
      { status: state.meStatus }
    );
  };
  const app = await buildWebApp({
    client,
    authRuntime: { config, store, oidc: {} },
    activityFetch,
  });
  const exchange = (payload = {}, origin = config.activity.origin) =>
    app.inject({
      url: '/api/activity/exchange',
      method: 'POST',
      headers: { origin },
      payload: { code: 'CODE', guildId: G, channelId: C, ...payload },
    });
  return { app, store, config, state, calls, exchange, client, channel };
}
test('Activity APIs recheck launch admission, isolate OIDC and require exact-origin CSRF and moderator administration', async () => {
  const f = await fixture();
  try {
    const r = await f.exchange();
    const cookie = r.headers['set-cookie'].split(';')[0];
    const headers = { cookie, origin: f.config.activity.origin };
    const s = await f.app.inject({ url: '/api/activity/session', headers });
    assert.equal(s.json().authenticated, true);
    assert.equal(
      (await f.app.inject({ url: '/api/auth/session', headers })).json().authenticated,
      false
    );
    assert.equal((await f.app.inject({ url: '/api/sounds', headers })).statusCode, 200);
    assert.equal(
      (
        await f.app.inject({
          url: '/api/auth/session',
          headers: { cookie: '__Host-bg_session=' + cookie.split('=')[1] },
        })
      ).json().authenticated,
      false
    );
    assert.equal(
      (
        await f.app.inject({
          url: '/api/sounds',
          headers: { ...headers, authorization: 'Bearer wrong' },
        })
      ).statusCode,
      401
    );
    assert.equal(
      (await f.app.inject({ url: '/api/sounds', headers: { cookie: cookie + '; ' + cookie } }))
        .statusCode,
      401
    );
    const standalone = await f.store.createSession({
      issuer: f.config.issuer,
      subject: 's',
      name: 'Standalone',
    });
    assert.equal(
      (
        await f.app.inject({
          url: '/api/sounds',
          headers: { cookie: '__Secure-bg_activity=' + standalone },
        })
      ).statusCode,
      401
    );
    const mutate = { ...headers, 'x-csrf-token': s.json().csrfToken };
    assert.equal(
      (
        await f.app.inject({
          url: '/api/sounds/tags',
          method: 'POST',
          headers: mutate,
          payload: { tag: 'denied' },
        })
      ).statusCode,
      403
    );
    assert.equal(
      (await f.app.inject({ url: '/api/bot/disconnect', method: 'POST', headers })).statusCode,
      403
    );
    assert.equal(
      (
        await f.app.inject({
          url: '/api/bot/disconnect',
          method: 'POST',
          headers: { ...mutate, origin: f.config.origin },
        })
      ).statusCode,
      403
    );
    f.state.admin = true;
    assert.equal(
      (
        await f.app.inject({
          url: '/api/sounds/missing/metadata',
          method: 'PATCH',
          headers: mutate,
          payload: { displayName: 'x' },
        })
      ).statusCode,
      404
    );
    f.state.permissions = false;
    assert.equal((await f.app.inject({ url: '/api/bot/status', headers })).statusCode, 403);
    f.state.permissions = true;
    f.state.voice = '999999999999999999';
    for (const path of ['/api/sounds', '/api/sounds/fixture/stream', '/api/bot/status'])
      assert.equal((await f.app.inject({ url: path, headers })).statusCode, 403, path);
    f.state.voice = C;
    f.state.member = false;
    assert.equal((await f.app.inject({ url: '/api/sounds', headers })).statusCode, 403);
    f.state.member = true;
    await f.store.revokeSubject('https://discord.com', U);
    assert.equal((await f.app.inject({ url: '/api/sounds', headers })).statusCode, 401);
  } finally {
    await f.app.close();
    await f.store.close();
  }
});
test('Activity status and disconnect use only the admitted launch channel, never global services', async () => {
  const f = await fixture();
  try {
    const r = await f.exchange();
    const headers = {
      cookie: r.headers['set-cookie'].split(';')[0],
      origin: f.config.activity.origin,
    };
    const s = (await f.app.inject({ url: '/api/activity/session', headers })).json();
    const status = await f.app.inject({ url: '/api/bot/status', headers });
    assert.deepEqual(status.json(), { online: true, connected: false });
    const disconnected = await f.app.inject({
      url: '/api/bot/disconnect',
      method: 'POST',
      headers: { ...headers, 'x-csrf-token': s.csrfToken },
    });
    assert.equal(disconnected.statusCode, 400);
    assert.match(disconnected.json().message, /launch channel/);
  } finally {
    await f.app.close();
    await f.store.close();
  }
});
test('exchange denies forged identity, foreign guild/channel, absent member, permissions, replay and rate abuse', async () => {
  const f = await fixture();
  try {
    for (const payload of [
      { userId: U },
      { guildId: '999999999999999999' },
      { channelId: '999999999999999999' },
      { guildId: 'bad' },
    ]) {
      const r = await f.exchange(payload);
      assert.ok([400, 403].includes(r.statusCode));
      assert.equal(r.headers['set-cookie'], undefined);
    }
    f.state.token = false;
    assert.equal((await f.exchange({ code: 'invalid-token' })).statusCode, 403);
    f.state.token = true;
    f.state.audience = '999999999999999999';
    assert.equal((await f.exchange({ code: 'wrong-audience' })).statusCode, 403);
    f.state.audience = f.config.activity.clientId;
    f.state.member = false;
    assert.equal((await f.exchange({ code: 'not-member' })).statusCode, 403);
    f.state.member = true;
    f.state.permissions = false;
    assert.equal((await f.exchange({ code: 'permissions' })).statusCode, 403);
    f.state.permissions = true;
    assert.equal((await f.exchange({ code: 'replay' })).statusCode, 200);
    assert.equal((await f.exchange({ code: 'replay' })).statusCode, 403);
    assert.equal((await f.exchange({}, 'https://evil.test')).statusCode, 403);
    for (let i = 0; i < 12; i++) await f.exchange({ code: 'rate-' + i });
    assert.equal((await f.exchange({ code: 'limited' })).statusCode, 429);
  } finally {
    await f.app.close();
    await f.store.close();
  }
});
test('expired, wrong-scope and rejected OAuth identity responses cannot issue Activity sessions', async () => {
  const f = await fixture();
  try {
    f.state.meStatus = 401;
    assert.equal((await f.exchange({ code: 'rejected' })).statusCode, 403);
    f.state.meStatus = 200;
    f.state.scopes = [];
    assert.equal((await f.exchange({ code: 'scope' })).statusCode, 403);
    f.state.scopes = ['identify'];
    f.state.expires = '2000-01-01T00:00:00Z';
    const r = await f.exchange({ code: 'expired' });
    assert.equal(r.statusCode, 403);
    assert.equal(r.headers['set-cookie'], undefined);
  } finally {
    await f.app.close();
    await f.store.close();
  }
});
test('verified code exchange issues isolated partitioned cookie and transient SDK token', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.app.inject({ url: '/api/activity/config' })).statusCode, 200);
    const r = await f.exchange();
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().access_token, 'TRANSIENT_TOKEN');
    const cookie = r.headers['set-cookie'];
    for (const flag of [
      '__Secure-bg_activity=',
      'HttpOnly',
      'Secure',
      'SameSite=None',
      'Partitioned',
      'Domain=1434488648228929629.discordsays.com',
      'Max-Age=900',
    ])
      assert.ok(cookie.includes(flag), flag);
    assert.ok(!cookie.includes('bg_session'));
    const session = await f.store.getSession(cookie.split(';')[0].split('=')[1]);
    assert.equal(session.identity.subject, U);
    assert.deepEqual(session.identity.activity, { guildId: G, channelId: C });
    assert.ok(!JSON.stringify(session).includes('TRANSIENT_TOKEN'));
    assert.deepEqual(
      f.calls.map(([url]) => url),
      ['https://discord.com/api/oauth2/token', 'https://discord.com/api/v10/oauth2/@me']
    );
    for (const [, init] of f.calls) {
      assert.equal(init.redirect, 'error');
      assert.ok(init.signal);
    }
  } finally {
    await f.app.close();
    await f.store.close();
  }
});
