import test from 'node:test';
import assert from 'node:assert/strict';
import { apiFetch, setCsrfToken, subscribeAuthExpired } from './request.ts';
test('requests carry same-origin cookies, mutation CSRF, never key; 401 expires auth', async () => {
  const original = globalThis.fetch;
  let last;
  let expired = 0;
  const unsub = subscribeAuthExpired(() => expired++);
  globalThis.fetch = async (url, init) => {
    last = { url, init };
    return new Response('blob', { status: url.includes('expired') ? 401 : 200 });
  };
  try {
    setCsrfToken('fixture-csrf');
    await apiFetch('/api/sounds/tags', { method: 'POST' });
    assert.equal(last.init.credentials, 'same-origin');
    assert.equal(new Headers(last.init.headers).get('x-csrf-token'), 'fixture-csrf');
    assert.equal(new Headers(last.init.headers).get('authorization'), null);
    await apiFetch('/api/sounds/a/stream');
    assert.equal(new Headers(last.init.headers).get('x-csrf-token'), null);
    await apiFetch('/api/expired');
    assert.equal(expired, 1);
    assert.throws(() => apiFetch('https://evil.test'));
  } finally {
    globalThis.fetch = original;
    unsub();
  }
});
