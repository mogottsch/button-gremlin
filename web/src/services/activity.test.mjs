import test from 'node:test';
import assert from 'node:assert/strict';
import * as activity from './activity.ts';
test(
  'bootstrap times out a stalled handshake without authorizing or exchanging later',
  { timeout: 100 },
  async () => {
    let release;
    let authorized = false;
    const sdk = {
      guildId: 'g',
      channelId: 'c',
      ready: () => new Promise((r) => (release = r)),
      commands: {
        authorize: async () => {
          authorized = true;
          return { code: 'late' };
        },
        authenticate: async () => {},
      },
    };
    const keepAlive = setTimeout(() => {}, 200);
    try {
      await assert.rejects(
        activity.bootstrapActivity(sdk, 'app', async () => Response.json({}), { timeoutMs: 10 }),
        /timed out/
      );
    } finally {
      clearTimeout(keepAlive);
    }
    release();
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(authorized, false);
  }
);
test('expired Discord SDK session cannot be treated as authenticated by bootstrap', async () => {
  const sdk = {
    guildId: 'g',
    channelId: 'c',
    ready: async () => {},
    commands: { authorize: async () => ({ code: 'c' }), authenticate: async () => ({}) },
  };
  await assert.rejects(
    activity.bootstrapActivity(sdk, 'app', async (url) =>
      Response.json(url.endsWith('exchange') ? { access_token: 'TOKEN' } : { authenticated: false })
    ),
    /session/
  );
});
test('concurrent Activity bootstraps share one SDK authorization and release failure for retry', async () => {
  assert.equal(typeof activity.singleFlight, 'function');
  let resolve;
  let calls = 0;
  const start = activity.singleFlight(() => {
    calls++;
    return new Promise((r) => (resolve = r));
  });
  const a = start(),
    b = start();
  assert.equal(calls, 1);
  assert.equal(a, b);
  resolve('session');
  await a;
  const c = start();
  assert.equal(calls, 2);
  resolve('next');
  await c;
  let fails = 0;
  const retry = activity.singleFlight(async () => {
    if (++fails === 1) throw Error('cancel');
    return 'ok';
  });
  await assert.rejects(retry());
  assert.equal(await retry(), 'ok');
});
test('Activity bootstrap follows ready authorize exchange authenticate session and keeps token transient', async () => {
  assert.equal(typeof activity.bootstrapActivity, 'function');
  const calls = [];
  const sdk = {
    guildId: '111111111111111111',
    channelId: '222222222222222222',
    ready: async () => {
      calls.push('ready');
    },
    commands: {
      authorize: async (args) => {
        calls.push(['authorize', args]);
        return { code: 'CODE' };
      },
      authenticate: async (args) => {
        calls.push(['authenticate', args]);
        return { user: { id: 'not-trusted' } };
      },
    },
  };
  const request = async (url, init) => {
    calls.push([url, init]);
    return Response.json(
      url.endsWith('exchange')
        ? { access_token: 'TRANSIENT' }
        : {
            authenticated: true,
            csrfToken: 'CSRF',
            identity: { subject: 'verified', name: 'Server name' },
          }
    );
  };
  const result = await activity.bootstrapActivity(sdk, '1434488648228929629', request);
  assert.equal(result.identity.subject, 'verified');
  assert.ok(!JSON.stringify(result).includes('TRANSIENT'));
  assert.deepEqual(
    calls.map((c) => (Array.isArray(c) ? c[0] : c)),
    ['ready', 'authorize', '/api/activity/exchange', 'authenticate', '/api/activity/session']
  );
  assert.equal(calls[1][1].prompt, 'none');
  assert.deepEqual(calls[1][1].scope, ['identify']);
  assert.deepEqual(calls[3][1], { access_token: 'TRANSIENT' });
  assert.deepEqual(JSON.parse(calls[2][1].body), {
    code: 'CODE',
    guildId: sdk.guildId,
    channelId: sdk.channelId,
  });
});
