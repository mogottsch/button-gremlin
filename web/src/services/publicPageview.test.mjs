import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

const sdk = readFileSync(new URL('../../tests/fixtures/umami-3.4.1.js', import.meta.url), 'utf8');
const tick = () => new Promise((resolve) => setImmediate(resolve));
async function fixture({
  path = '/',
  dnt = '',
  windowDnt = '',
  msDnt = '',
  embedded = false,
  delayed = false,
  origin = 'https://button-gremlin.moket-home.de',
  referrer = 'https://example.org/private/token?secret=x#signed',
} = {}) {
  const writes = [],
    scripts = [];
  const location = new URL(path, origin);
  const document = {
    title: 'PRIVATE ACCOUNT TITLE',
    referrer,
    readyState: 'complete',
    createElement: () => ({
      attrs: {},
      setAttribute(k, v) {
        this.attrs[k] = v;
      },
      getAttribute(k) {
        return this.attrs[k] ?? null;
      },
      remove() {},
    }),
    head: {
      appendChild(script) {
        scripts.push(script);
        if (!delayed) load();
      },
    },
    addEventListener() {},
  };
  const browser = {
    location,
    document,
    screen: { width: 800, height: 600 },
    navigator: { language: 'en', doNotTrack: dnt, msDoNotTrack: msDnt },
    doNotTrack: windowDnt,
    localStorage: {
      getItem() {
        return null;
      },
    },
    history: { pushState() {}, replaceState() {} },
    URL,
    setTimeout,
    clearTimeout,
    Promise,
    fetch: async (url, init) => {
      writes.push({ url, ...init, body: JSON.parse(init.body) });
      return { json: async () => ({ cache: 'fixture-cache' }) };
    },
  };
  browser.window = browser;
  browser.self = browser;
  browser.top = embedded ? {} : browser;
  const context = vm.createContext(browser);
  function load() {
    document.currentScript = scripts[0];
    vm.runInContext(sdk, context);
    scripts[0].onload();
  }
  const { createPublicPageview } = await import('./publicPageview.ts');
  const controller = createPublicPageview(browser);
  return { browser, controller, writes, scripts, load };
}

test('fixture pins actual released SDK bytes', () => {
  assert.equal(
    createHash('sha256').update(sdk).digest('hex'),
    '654f12c7548be726eba5b71d5ef8bffc2a41a39a0053e2a49a847869ccd7ac3f'
  );
});
test('settled anonymous public entry emits one fixed sanitized pageview through real SDK', async () => {
  const f = await fixture();
  f.controller.setPublicEntry(true);
  await tick();
  assert.equal(f.writes.length, 1);
  assert.deepEqual(f.writes[0].body, {
    type: 'event',
    payload: {
      website: 'ecf41265-6b9b-436d-83bb-094992f68815',
      hostname: 'button-gremlin.moket-home.de',
      url: '/',
      title: 'Button Gremlin',
      referrer: 'https://example.org',
    },
  });
  assert.equal(f.writes[0].url, 'https://stats.mogott.sh/api/send');
  assert.equal(f.writes[0].credentials, 'omit');
  assert.equal(f.writes[0].referrerPolicy, 'no-referrer');
  assert.equal(f.scripts[0].crossOrigin, 'anonymous');
  assert.equal(f.scripts[0].referrerPolicy, 'no-referrer');
  assert.equal(f.scripts[0].getAttribute('data-domains'), 'button-gremlin.moket-home.de');
  assert.equal(f.scripts[0].getAttribute('data-do-not-track'), 'true');
  assert.equal(f.scripts[0].getAttribute('data-performance'), 'false');
  assert.equal(f.scripts[0].getAttribute('data-auto-track'), 'false');
});
test('pending auth/Activity/private lifecycle never loads SDK or writes', async () => {
  const f = await fixture();
  f.controller.setPublicEntry(false);
  await tick();
  assert.equal(f.scripts.length, 0);
  assert.equal(f.writes.length, 0);
});
for (const path of [
  '/room/private-token',
  '/invite/signed-token',
  '/api/auth/callback?code=secret',
  '/account',
  '/share/signed',
  '/?room=secret',
  '/?authError=secret',
  '/?loggedOut=1',
  '/?view=mine',
  '/#secret',
]) {
  test(`rejects non-public location ${path}`, async () => {
    const f = await fixture({ path });
    f.controller.setPublicEntry(true);
    await tick();
    assert.equal(f.writes.length, 0);
    assert.equal(f.scripts.length, 0);
  });
}
for (const options of [
  { dnt: '1' },
  { dnt: 'yes' },
  { embedded: true },
  { origin: 'http://button-gremlin.moket-home.de' },
  { origin: 'https://1434488648228929629.discordsays.com' },
]) {
  test(`rejects browser boundary ${JSON.stringify(options)}`, async () => {
    const f = await fixture(options);
    f.controller.setPublicEntry(true);
    await tick();
    assert.equal(f.writes.length, 0);
    assert.equal(f.scripts.length, 0);
  });
}
for (const fields of [
  { windowDnt: '0', dnt: '1' },
  { dnt: '0', msDnt: '1' },
  { windowDnt: '0', dnt: '0', msDnt: 'yes' },
  { windowDnt: '0', dnt: 'YeS' },
  { dnt: '0', msDnt: 'YES' },
  { windowDnt: 'YES', dnt: '0', msDnt: '0' },
  { windowDnt: 1, dnt: '0' },
  { windowDnt: '0', dnt: 1 },
  { dnt: '0', msDnt: 1 },
]) {
  test(`conflicting DNT fields deny SDK loading and writes ${JSON.stringify(fields)}`, async () => {
    const f = await fixture(fields);
    f.controller.setPublicEntry(true);
    await tick();
    assert.equal(f.scripts.length, 0, 'opt-out must block SDK loading');
    assert.equal(f.writes.length, 0, 'opt-out must block collection');
  });
}
test('non-opt-out DNT fields still permit one actual SDK pageview', async () => {
  const f = await fixture({ windowDnt: '0', dnt: '0', msDnt: 'no' });
  f.controller.setPublicEntry(true);
  await tick();
  assert.equal(f.scripts.length, 1);
  assert.equal(f.writes.length, 1);
});
test('conflicting DNT opt-out after SDK callback acceptance cancels final transport', async () => {
  const f = await fixture({ delayed: true, windowDnt: '0', dnt: '0' });
  f.controller.setPublicEntry(true);
  f.load();
  f.browser.navigator.msDoNotTrack = 'YES';
  await tick();
  assert.equal(f.writes.length, 0);
});
test('StrictMode cleanup/restart and repeated entry never double count', async () => {
  const f = await fixture({ delayed: true });
  f.controller.setPublicEntry(true);
  f.controller.setPublicEntry(false);
  f.controller.setPublicEntry(true);
  f.load();
  await tick();
  f.controller.setPublicEntry(true);
  f.controller.setPublicEntry(false);
  f.controller.setPublicEntry(true);
  await tick();
  assert.equal(f.scripts.length, 1);
  assert.equal(f.writes.length, 1);
});
test('late SDK load after auth starts or private navigation produces zero writes', async () => {
  for (const change of [
    (f) => f.controller.setPublicEntry(false),
    (f) => {
      f.browser.location = new URL('https://button-gremlin.moket-home.de/room/secret');
    },
  ]) {
    const f = await fixture({ delayed: true });
    f.controller.setPublicEntry(true);
    change(f);
    f.load();
    await tick();
    assert.equal(f.writes.length, 0);
  }
});
test('eligibility revoked after before-send acceptance cancels the SDK microtask transport', async () => {
  for (const revoke of [
    (f) => f.controller.setPublicEntry(false),
    (f) => {
      f.browser.location = new URL('https://button-gremlin.moket-home.de/room/secret');
    },
  ]) {
    const f = await fixture({ delayed: true });
    f.controller.setPublicEntry(true);
    f.load();
    // Actual released SDK has accepted the callback, but awaits it before fetch.
    revoke(f);
    await tick();
    assert.equal(f.writes.length, 0);
  }
});
test('temporary SDK transport guard preserves unrelated API options and restores fetch', async () => {
  const f = await fixture({ delayed: true });
  const original = f.browser.fetch;
  f.controller.setPublicEntry(true);
  f.load();
  const init = {
    method: 'POST',
    credentials: 'include',
    headers: { 'X-CSRF': 'fixture' },
    body: '{"private":true}',
  };
  await f.browser.fetch('/api/private', init);
  await tick();
  const api = f.writes.find((write) => write.url === '/api/private');
  assert.equal(api.credentials, 'include');
  assert.deepEqual(api.headers, init.headers);
  assert.deepEqual(api.body, { private: true });
  assert.equal(api.referrerPolicy, undefined);
  assert.equal(f.browser.fetch, original);
});
test('SDK custom events, identify, performance and unsolicited pageviews are denied', async () => {
  const f = await fixture();
  f.controller.setPublicEntry(true);
  await tick();
  await f.browser.umami.track('private-event', { token: 'secret' });
  await f.browser.umami.identify('secret', { account: 'private' });
  await f.browser.umami.track();
  f.browser.history.pushState({}, 'private title', '/room/token');
  await tick();
  assert.equal(f.writes.length, 1);
});
for (const referrer of [
  'http://example.org/private',
  'javascript:secret',
  'not a URL',
  'https://user:secret@example.org/private',
  '',
]) {
  test(`unsafe referrer is omitted: ${referrer}`, async () => {
    const f = await fixture({ referrer });
    f.controller.setPublicEntry(true);
    await tick();
    assert.equal(f.writes[0].body.payload.referrer, '');
  });
}
