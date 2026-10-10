import { test, expect } from '@playwright/test';
async function login(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Sign in with Discord' }).click();
  await expect(page.getByRole('button', { name: 'Logout' })).toBeVisible();
}
test('Chromium sends outstanding transaction cookies on login and rejects the ninth start', async ({
  page,
  context,
}) => {
  await page.goto('/');
  // Real Chromium fetch stores Set-Cookie but stops before the identity redirect.
  for (let i = 0; i < 8; i++) {
    expect(
      await page.evaluate(async () => (await fetch('/api/auth/login', { redirect: 'manual' })).type)
    ).toBe('opaqueredirect');
  }
  const pending = (await context.cookies()).filter((c) => c.name.startsWith('bg_oidc_tx_'));
  expect(pending).toHaveLength(8);
  const ninth = await page.evaluate(async () => {
    const response = await fetch('/api/auth/login', { redirect: 'manual' });
    return {
      status: response.status,
      body: response.type === 'opaqueredirect' ? null : await response.json(),
    };
  });
  expect(ninth.status).toBe(429);
  expect(ninth.body).toEqual({ error: 'Too many pending logins' });
  expect((await context.cookies()).filter((c) => c.name.startsWith('bg_oidc_tx_'))).toHaveLength(8);
});
test('broker login reload cookie audio without key, logout and replay denial', async ({
  page,
  context,
  request,
}) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('apiKey', 'obsolete-fixture-key'));
  await page.reload();
  await expect(page.getByRole('button', { name: 'Sign in with Discord' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('apiKey'))).toBeNull();
  const requests: string[] = [];
  page.on('request', (req) => {
    if (req.url().includes('/api/')) requests.push(JSON.stringify(req.headers()));
  });
  await login(page);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Logout' })).toBeVisible();
  await expect(page.getByText('Fixture Sound', { exact: true })).toBeVisible();
  await page
    .locator('.group')
    .filter({ hasText: 'Fixture Sound' })
    .locator('button')
    .first()
    .click();
  await expect
    .poll(() => page.locator('audio').evaluate((a: HTMLAudioElement) => a.readyState))
    .toBeGreaterThanOrEqual(2);
  expect(await page.locator('audio').getAttribute('src')).toMatch(/^blob:/);
  expect(requests.every((h) => !h.includes('authorization'))).toBeTruthy();
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage }))).not.toContain('TOKEN');
  expect(await page.content()).not.toContain('NEVER-EXPOSE');
  const old = (await context.cookies()).find((c) => c.name === 'bg_session');
  expect(old).toBeTruthy();
  await page.route('**/api/auth/logout', (route) =>
    route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"fixture"}' })
  );
  await page.getByRole('button', { name: 'Logout' }).click();
  await expect(page.getByRole('alert')).toContainText('Logout failed');
  await expect(page.getByRole('button', { name: 'Logout' })).toBeVisible();
  await page.unroute('**/api/auth/logout');
  await page.getByRole('button', { name: 'Logout' }).click();
  await expect(page.getByRole('button', { name: 'Sign in with Discord' })).toBeVisible();
  await expect(page.locator('audio')).toHaveCount(0);
  expect(
    (await request.get('/api/sounds', { headers: { Cookie: `bg_session=${old?.value}` } })).status()
  ).toBe(401);
  expect((await request.get('http://127.0.0.1:13001/preserved')).ok()).toBeTruthy();
});
test('zero-entitlement denial, browser revocation, fresh login', async ({ page, request }) => {
  await request.post('http://127.0.0.1:13001/mode/denied');
  await page.goto('/');
  await page.getByRole('button', { name: 'Sign in with Discord' }).click();
  await expect(page.getByRole('alert')).toContainText('access was denied');
  expect((await request.get('/api/auth/session')).status()).toBe(200);
  expect(await page.evaluate(() => document.cookie)).not.toContain('bg_session');
  await request.post('http://127.0.0.1:13001/mode/success');
  await login(page);
  await request.post('http://127.0.0.1:13001/revoke');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Sign in with Discord' })).toBeVisible();
  await login(page);
});
test('sound metadata, upload/delete and cookie mutation CSRF in real browser', async ({
  page,
  request,
}) => {
  await login(page);
  const result = await page.evaluate(async () => {
    const session = await (await fetch('/api/auth/session')).json();
    const headers = { 'X-CSRF-Token': session.csrfToken, 'Content-Type': 'application/json' };
    const denied = await fetch('/api/sounds/tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tag: 'no' }),
    });
    const created = await fetch('/api/sounds/tags', {
      method: 'POST',
      headers,
      body: JSON.stringify({ tag: 'e2e' }),
    });
    const patched = await fetch('/api/sounds/fixture/metadata', {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ tags: ['fixture', 'e2e'] }),
    });
    const blob = await (await fetch('/api/sounds/fixture/stream')).blob();
    const form = new FormData();
    form.append('sound', blob, 'uploaded.wav');
    const uploaded = await fetch('/api/sounds/upload', {
      method: 'POST',
      headers: { 'X-CSRF-Token': session.csrfToken },
      body: form,
    });
    const streamed = await fetch('/api/sounds/uploaded/stream');
    const deleted = await fetch('/api/sounds/uploaded', {
      method: 'DELETE',
      headers: { 'X-CSRF-Token': session.csrfToken },
    });
    const status = await fetch('/api/bot/status');
    const play = await fetch('/api/bot/play', {
      method: 'POST',
      headers,
      body: JSON.stringify({ soundName: 'fixture' }),
    });
    const disconnect = await fetch('/api/bot/disconnect', {
      method: 'POST',
      headers: { 'X-CSRF-Token': session.csrfToken },
    });
    if (play.status !== 200 || disconnect.status !== 200)
      throw new Error('Mocked bot calls failed');
    return {
      denied: denied.status,
      created: created.status,
      patched: patched.status,
      uploaded: uploaded.status,
      streamed: streamed.status,
      deleted: deleted.status,
      status: await status.json(),
    };
  });
  expect(result).toEqual({
    denied: 403,
    created: 200,
    patched: 200,
    uploaded: 200,
    streamed: 200,
    deleted: 200,
    status: { online: true, connected: false },
  });
  const preserved = await (await request.get('http://127.0.0.1:13001/preserved')).json();
  expect(await (await request.get('http://127.0.0.1:13001/bot-calls')).json()).toEqual({
    play: 1,
    disconnect: 1,
  });
  expect(preserved.preserved).toBe(true);
});
