import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Execute the actual AuthProvider source. Hook/API doubles allow deterministic
// promise interleavings; full rendered behavior is separately covered by Playwright.
const source = readFileSync(new URL('../hooks/useAuth.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const tick = () => new Promise((resolve) => setImmediate(resolve));
function fixture() {
  let resolve, expire;
  const checks = [],
    cleanups = [];
  const session = new Promise((done) => {
    resolve = done;
  });
  const modules = {
    react: {
      createContext: () => ({ Provider: 'provider' }),
      useState: (value) => [value, () => {}],
      useRef: (value) => ({ current: value }),
      useCallback: (fn) => fn,
      useEffect: (fn) => cleanups.push(fn()),
    },
    'react/jsx-runtime': { jsx: (_type, props) => props },
    '../services/api': { api: { auth: { session: () => session, logout: async () => {} } } },
    '../services/request': {
      setCsrfToken() {},
      subscribeAuthExpired: (fn) => {
        expire = fn;
        return () => {};
      },
    },
    '../services/activity': { isActivityLaunch: () => false },
    '../services/standalone': {
      standaloneLogin: () => false,
      standaloneAuthenticated() {},
      suppressStandalone() {},
    },
    '../services/publicPageview': { setPublicEntry: (value) => checks.push(value) },
  };
  const context = {
    exports: {},
    require: (name) => {
      assert.ok(modules[name], `unexpected module ${name}`);
      return modules[name];
    },
    localStorage: { removeItem() {} },
    window: { addEventListener() {}, removeEventListener() {}, location: { assign() {} } },
  };
  vm.runInNewContext(compiled, context);
  const provider = context.exports.AuthProvider({ children: null });
  return { checks, resolve, expire: () => expire(), cleanups, actions: provider.value };
}
test('session expiration between anonymous handler and finally never restores public eligibility', async () => {
  const f = fixture();
  f.resolve({ authenticated: false });
  await Promise.resolve(); // Actual session .then ran; its finally has not.
  f.expire();
  await tick();
  assert.ok(!f.checks.includes(true));
});
test('explicit login between anonymous handler and finally cannot restore stale eligibility', async () => {
  const f = fixture();
  f.resolve({ authenticated: false });
  await Promise.resolve();
  f.actions.login();
  await tick();
  assert.ok(!f.checks.includes(true));
});
test('cleanup while auth is unresolved never enables public eligibility from a late result', async () => {
  const f = fixture();
  f.cleanups.forEach((fn) => fn());
  f.resolve({ authenticated: false });
  await tick();
  assert.ok(!f.checks.includes(true));
});
test('settled inert anonymous session enables public eligibility once; authenticated never does', async () => {
  for (const authenticated of [false, true]) {
    const f = fixture();
    f.resolve({ authenticated });
    await tick();
    assert.equal(f.checks.filter(Boolean).length, authenticated ? 0 : 1);
  }
});
