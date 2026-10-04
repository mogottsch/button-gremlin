import test from 'node:test';
import assert from 'node:assert/strict';
import { RedisAuthStore } from '../auth/store.ts';
const url = process.env.REDIS_TEST_URL;
test(
  'Redis binding atomic consumption, sessions, revocation, missing generation fail closed',
  { skip: !url },
  async () => {
    const a = await RedisAuthStore.connect(url, 'fixture-secret'.repeat(4));
    const b = await RedisAuthStore.connect(url, 'fixture-secret'.repeat(4));
    try {
      const state = crypto.randomUUID();
      await a.putTransaction(state, {
        binding: 'browser',
        nonce: 'nonce',
        verifier: 'v',
        returnTo: '/',
      });
      assert.equal(await b.takeTransaction(state, 'wrong'), null);
      const outcomes = await Promise.all([
        a.takeTransaction(state, 'browser'),
        b.takeTransaction(state, 'browser'),
      ]);
      assert.equal(outcomes.filter(Boolean).length, 1);
      const identity = { issuer: 'https://issuer/', subject: crypto.randomUUID(), name: 'Fixture' };
      const token = await a.createSession(identity);
      assert.equal((await b.getSession(token)).identity.subject, identity.subject);
      await b.revokeSubject(identity.issuer, identity.subject);
      assert.equal(await a.getSession(token), null);
      const fresh = await b.createSession(identity);
      assert.ok(await a.getSession(fresh));
      await b.deleteSession(fresh);
      assert.equal(await a.getSession(fresh), null);
    } finally {
      await a.close();
      await b.close();
    }
  }
);
