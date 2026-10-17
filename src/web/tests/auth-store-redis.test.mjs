import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { createClient } from 'redis';
import { RedisAuthStore } from '../auth/store.ts';
import { randomToken } from '../auth/store.ts';
const url = process.env.REDIS_TEST_URL;
const secret = 'worker-fixture-secret'.repeat(4);
test(
  'independent Redis clients serialize guarded issuance against logout and fail closed on lost browser epoch',
  { skip: !url },
  async () => {
    const secret = randomToken();
    const a = await RedisAuthStore.connect(url, secret);
    const b = await RedisAuthStore.connect(url, secret);
    const raw = createClient({ url });
    await raw.connect();
    try {
      for (let i = 0; i < 10; i++) {
        const browser = randomToken();
        const state = randomToken();
        const binding = randomToken();
        const browserGeneration = await a.browserGeneration(browser);
        await a.putTransaction(state, {
          phase: 'probe',
          browser,
          browserGeneration,
          binding,
          nonce: randomToken(),
          verifier: randomToken(),
          returnTo: '/',
        });
        const guard = await b.takeTransaction(state, binding);
        const identity = { issuer: 'https://fixture/', subject: randomToken(), name: 'Fixture' };
        const first = await a.createSession(identity, guard);
        const outcomes = await Promise.allSettled([
          a.createSession(identity, guard),
          b.logoutSession(first, browser),
        ]);
        assert.equal(await a.getSession(first), null);
        if (outcomes[0].status === 'fulfilled')
          assert.equal(await b.getSession(outcomes[0].value), null);
        await assert.rejects(() => b.createSession(identity, guard), /invalidated/);
        const next = await a.browserGeneration(browser);
        assert.notEqual(next, browserGeneration);
        assert.equal(await b.validBrowserGeneration(browser, browserGeneration), false);
        await raw.del(a.key('browser', browser));
        assert.equal(await b.validBrowserGeneration(browser, next), false);
      }
    } finally {
      await raw.close();
      await a.close();
      await b.close();
    }
  }
);
function worker(payload) {
  return new Promise((resolve, reject) => {
    const child = fork(new URL('./redis-worker.mjs', import.meta.url), [], {
      stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Worker timeout'));
    }, 10000);
    child.once('message', (value) => {
      clearTimeout(timer);
      value.error ? reject(new Error(value.error)) : resolve(value.result);
    });
    child.once('error', reject);
    child.send({ url, secret, ...payload });
  });
}
test(
  'real separate workers race callback and share sessions/logout/revocation',
  { skip: !url },
  async () => {
    const a = await RedisAuthStore.connect(url, secret);
    const raw = createClient({ url });
    await raw.connect();
    try {
      const state = crypto.randomUUID();
      await a.putTransaction(state, {
        binding: 'browser',
        nonce: 'n',
        verifier: 'v',
        returnTo: '/',
      });
      assert.equal(await worker({ action: 'take', state, binding: 'wrong' }), null);
      const outcomes = await Promise.all([
        worker({ action: 'take', state, binding: 'browser' }),
        worker({ action: 'take', state, binding: 'browser' }),
      ]);
      assert.equal(outcomes.filter(Boolean).length, 1);
      const identity = { issuer: 'https://fixture/', subject: crypto.randomUUID(), name: 'Worker' };
      const token = await a.createSession(identity);
      assert.equal((await worker({ action: 'get', token })).identity.subject, identity.subject);
      await worker({ action: 'delete', token });
      assert.equal(await a.getSession(token), null);
      const t1 = await a.createSession(identity);
      const t2 = await a.createSession(identity);
      await worker({ action: 'revoke', ...identity }); // issuer + subject exact
      assert.equal(await a.getSession(t1), null);
      assert.equal(await worker({ action: 'get', token: t2 }), null);
      const t3 = await a.createSession(identity);
      const key = a.key('generation', JSON.stringify([identity.issuer, identity.subject]));
      await raw.del(key);
      assert.equal(await a.getSession(t3), null);
      const t4 = await a.createSession(identity);
      assert.equal(await a.getSession(t3), null);
      assert.ok(await a.getSession(t4));
      const sessionKey = a.key('session', t4);
      const session = JSON.parse(await raw.get(sessionKey));
      session.expiresAt = Date.now() - 1;
      await raw.set(sessionKey, JSON.stringify(session));
      assert.equal(await a.getSession(t4), null);
      // A revoke after atomic issuance invalidates it; issuance after revoke gets the new generation.
      const raced = await a.createSession(identity);
      await a.revokeSubject(identity.issuer, identity.subject);
      assert.equal(await a.getSession(raced), null);
    } finally {
      await raw.quit();
      await a.close();
    }
  }
);
