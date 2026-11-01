import { test, expect, type Page, type Route } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const origin = 'https://button-gremlin.moket-home.de';
const sdk = readFileSync(path.resolve('tests/fixtures/umami-3.4.1.js'));
const dist = path.resolve('dist');
async function fixture(
  page: Page,
  {
    authenticated = false,
    suppress = true,
    outage = false,
    delayed = false,
    brokenSdk = false,
    appOrigin = origin,
  } = {}
) {
  const writes: { body: unknown; headers: Record<string, string> }[] = [];
  let script: Route | undefined;
  let loads = 0;
  // Every browser request is fulfilled or aborted. Never use the real collector or app.
  await page.route('**/*', async (route) => {
    const req = route.request(),
      url = new URL(req.url());
    if (url.origin === 'https://stats.mogott.sh') {
      if (url.pathname === '/script.js') {
        loads++;
        script = route;
        if (delayed) return;
        return route.fulfill({
          body: brokenSdk ? Buffer.concat([sdk, Buffer.from('\n// changed bytes')]) : sdk,
          contentType: 'application/javascript',
          headers: { 'Access-Control-Allow-Origin': '*' },
        });
      }
      if (url.pathname === '/api/send' && req.method() === 'POST') {
        writes.push({ body: req.postDataJSON(), headers: await req.allHeaders() });
        return route.fulfill({
          json: { cache: 'local-fixture-cache' },
          headers: { 'Access-Control-Allow-Origin': origin },
        });
      }
      return route.abort();
    }
    if (url.origin !== appOrigin) return route.abort();
    if (url.pathname === '/api/auth/session')
      return route.fulfill({
        status: outage ? 503 : 200,
        json: authenticated
          ? {
              authenticated: true,
              identity: { subject: 'PRIVATE_SUBJECT', name: 'PRIVATE_NAME' },
              csrfToken: 'PRIVATE_CSRF',
            }
          : { authenticated: false },
      });
    if (url.pathname.startsWith('/api/auth/login'))
      return route.fulfill({
        contentType: 'text/html',
        body: '<p>Local authentication destination</p>',
      });
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: [] });
    if (url.pathname.startsWith('/assets/'))
      return route.fulfill({
        body: readFileSync(path.join(dist, url.pathname)),
        contentType: url.pathname.endsWith('.js') ? 'application/javascript' : 'text/css',
      });
    return route.fulfill({
      body: readFileSync(path.join(dist, 'index.html')),
      contentType: 'text/html',
    });
  });
  await page.addInitScript(
    ({ suppress }) => {
      if (suppress) localStorage.setItem('bg.sso.loggedOut', '1');
      Object.defineProperty(document, 'referrer', {
        get: () => 'https://example.org/private/INVITE_TOKEN?code=SECRET#signed',
      });
    },
    { suppress }
  );
  return {
    writes,
    loads: () => loads,
    release: async () => {
      await script?.fulfill({
        body: sdk,
        contentType: 'application/javascript',
        headers: { 'Access-Control-Allow-Origin': '*' },
      });
    },
  };
}

test('actual built anonymous entry sends exactly one sanitized pageview, never identity/custom events', async ({
  page,
}) => {
  const f = await fixture(page);
  await page.goto(origin);
  await expect(page.getByRole('button', { name: 'Sign in with Discord' })).toBeVisible();
  await expect.poll(() => f.writes.length).toBe(1);
  expect(f.writes[0].body).toEqual({
    type: 'event',
    payload: {
      website: 'ecf41265-6b9b-436d-83bb-094992f68815',
      hostname: 'button-gremlin.moket-home.de',
      url: '/',
      title: 'Button Gremlin',
      referrer: 'https://example.org',
    },
  });
  expect(f.writes[0].headers.cookie).toBeUndefined();
  expect(f.writes[0].headers.referer).toBeUndefined();
  expect(f.writes[0].headers['x-umami-website-id']).toBe('ecf41265-6b9b-436d-83bb-094992f68815');
  await page.evaluate(async () => {
    document.title = 'PRIVATE_NAME';
    const tracker = (
      window as unknown as {
        umami: { track: (name?: string) => Promise<void>; identify: (id: string) => Promise<void> };
      }
    ).umami;
    await tracker.track('private-event');
    await tracker.identify('PRIVATE_SUBJECT');
    history.pushState({}, '', '/room/PRIVATE_ROOM?invite=SECRET#token');
    await tracker.track();
    history.replaceState({}, '', '/');
    await tracker.track();
  });
  await page.waitForTimeout(400);
  expect(f.writes).toHaveLength(1);
  expect(f.loads()).toBe(1);
});

for (const opts of [{ authenticated: true }, { suppress: false }, { outage: true }]) {
  test(`real auth lifecycle rejects ${JSON.stringify(opts)}`, async ({ page }) => {
    const f = await fixture(page, opts);
    await page.goto(origin);
    if (opts.authenticated)
      await expect(page.getByRole('button', { name: 'Logout' })).toBeVisible();
    else if (opts.outage) await expect(page.getByRole('alert')).toContainText('Unable to check');
    else await expect(page.getByText('Local authentication destination')).toBeVisible();
    await page.waitForTimeout(400);
    expect(f.writes).toHaveLength(0);
    expect(f.loads()).toBe(0);
  });
}
for (const location of [
  '/invite/SIGNED',
  '/room/PRIVATE',
  '/account',
  '/api/auth/callback?code=SECRET',
  '/share/SIGNED',
  '/?authError=SECRET',
  '/?loggedOut=1',
  '/?view=mine',
  '/#TOKEN',
]) {
  test(`built app rejects sensitive location ${location}`, async ({ page }) => {
    const f = await fixture(page);
    await page.goto(origin + location);
    await page.waitForTimeout(400);
    expect(f.writes).toHaveLength(0);
    expect(f.loads()).toBe(0);
  });
}
test('explicit auth and private navigation cancel a delayed SDK load', async ({ page }) => {
  const f = await fixture(page, { delayed: true });
  await page.goto(origin);
  await expect.poll(f.loads).toBe(1);
  await page.getByRole('button', { name: 'Sign in with Discord' }).click();
  await f.release();
  await page.waitForTimeout(400);
  expect(f.writes).toHaveLength(0);
});
test('private path before delayed SDK load is denied', async ({ page }) => {
  const f = await fixture(page, { delayed: true });
  await page.goto(origin);
  await expect.poll(f.loads).toBe(1);
  await page.evaluate(() => history.pushState({}, '', '/room/PRIVATE?invite=SECRET'));
  await f.release();
  await page.waitForTimeout(400);
  expect(f.writes).toHaveLength(0);
});
test('DNT suppresses loading and writes in the actual built app', async ({ page }) => {
  const f = await fixture(page);
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'doNotTrack', { get: () => '1' })
  );
  await page.goto(origin);
  await expect(page.getByRole('button', { name: 'Sign in with Discord' })).toBeVisible();
  await page.waitForTimeout(400);
  expect(f.writes).toHaveLength(0);
  expect(f.loads()).toBe(0);
});
for (const fields of [
  { windowDnt: '0', dnt: '1', msDnt: '' },
  { windowDnt: '', dnt: '0', msDnt: '1' },
  { windowDnt: '0', dnt: '0', msDnt: 'yes' },
  { windowDnt: '0', dnt: 'YeS', msDnt: '' },
  { windowDnt: '', dnt: '0', msDnt: 'YES' },
  { windowDnt: 'YES', dnt: '0', msDnt: '0' },
]) {
  test(`conflicting DNT fields block built app SDK loading and writes ${JSON.stringify(fields)}`, async ({
    page,
  }) => {
    const f = await fixture(page);
    await page.addInitScript(({ windowDnt, dnt, msDnt }) => {
      Object.defineProperty(window, 'doNotTrack', { get: () => windowDnt });
      Object.defineProperty(navigator, 'doNotTrack', { get: () => dnt });
      Object.defineProperty(navigator, 'msDoNotTrack', { get: () => msDnt });
    }, fields);
    await page.goto(origin);
    await expect(page.getByRole('button', { name: 'Sign in with Discord' })).toBeVisible();
    await page.waitForTimeout(400);
    expect({ loads: f.loads(), writes: f.writes.length }).toEqual({ loads: 0, writes: 0 });
  });
}
test('SDK version drift fails integrity closed without analytics writes', async ({ page }) => {
  const f = await fixture(page, { brokenSdk: true });
  await page.goto(origin);
  await expect(page.getByRole('button', { name: 'Sign in with Discord' })).toBeVisible();
  await expect.poll(f.loads).toBe(1);
  await page.waitForTimeout(400);
  expect(f.writes).toHaveLength(0);
});
test('exact Discord Activity origin never loads analytics', async ({ page }) => {
  const activityOrigin = 'https://1434488648228929629.discordsays.com';
  const f = await fixture(page, { appOrigin: activityOrigin });
  await page.goto(activityOrigin + '/?frame_id=PRIVATE');
  await expect(page.getByRole('button', { name: 'Retry Discord authorization' })).toBeVisible();
  await page.waitForTimeout(400);
  expect(f.writes).toHaveLength(0);
  expect(f.loads()).toBe(0);
});
test('embedded public origin uses Activity and never loads analytics', async ({ page }) => {
  const f = await fixture(page);
  await page.route('https://embed.example.org/', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<iframe src="${origin}/?frame_id=PRIVATE"></iframe>`,
    })
  );
  await page.goto('https://embed.example.org/');
  await expect(
    page.frameLocator('iframe').getByRole('button', { name: 'Retry Discord authorization' })
  ).toBeVisible();
  await page.waitForTimeout(400);
  expect(f.writes).toHaveLength(0);
  expect(f.loads()).toBe(0);
});
