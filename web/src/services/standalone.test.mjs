import test from 'node:test';
import assert from 'node:assert/strict';
import { standaloneLogin, standaloneAuthenticated, suppressStandalone } from './standalone.ts';
function setup(search = '') {
  const calls = [];
  const storage = () => {
    const values = new Map();
    return {
      getItem: (k) => values.get(k) ?? null,
      setItem: (k, v) => values.set(k, v),
      removeItem: (k) => values.delete(k),
    };
  };
  globalThis.localStorage = storage();
  globalThis.sessionStorage = storage();
  globalThis.window = {
    location: {
      href: 'https://app.test/?view=mine' + search,
      search: '?view=mine' + search,
      assign: (value) => calls.push(value),
    },
  };
  return calls;
}
test('one automatic standalone entry per episode; successful local session rearms expiry recovery', () => {
  const calls = setup();
  assert.equal(standaloneLogin(), true);
  assert.equal(standaloneLogin(), false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0], '/api/auth/login?returnTo=%2F%3Fview%3Dmine');
  standaloneAuthenticated();
  assert.equal(standaloneLogin(), true);
});
test('logout reload/back and terminal error stay inert; only explicit sign-in retries', () => {
  for (const query of ['&loggedOut=1', '&authError=login_failed']) {
    const calls = setup(query);
    assert.equal(standaloneLogin(), false);
    assert.equal(standaloneLogin(true), true);
    assert.equal(calls.length, 1);
    assert.ok(!calls[0].includes('authError'));
    assert.ok(!calls[0].includes('loggedOut'));
    assert.equal(calls[0], '/api/auth/login?returnTo=%2F%3Fview%3Dmine&explicit=1');
  }
  const calls = setup();
  suppressStandalone();
  assert.equal(standaloneLogin(), false);
  standaloneAuthenticated();
  assert.equal(standaloneLogin(), false);
  assert.equal(calls.length, 0);
  assert.equal(standaloneLogin(true), true);
});
test('unavailable durable storage never triggers automatic login loops', () => {
  setup();
  globalThis.sessionStorage.setItem = () => {
    throw Error('blocked');
  };
  assert.equal(standaloneLogin(), false);
  assert.equal(standaloneLogin(true), true);
});
test('quota failure during logout suppression still blocks racing401 in memory', () => {
  const calls = setup();
  globalThis.localStorage.setItem = () => {
    throw Error('QuotaExceededError');
  };
  suppressStandalone();
  assert.equal(standaloneLogin(), false);
  assert.equal(calls.length, 0);
  assert.equal(standaloneLogin(true), true);
});
