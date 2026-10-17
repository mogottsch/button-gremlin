import { test, expect } from '@playwright/test';
const control = 'http://127.0.0.1:13001';
const counts = async (request: import('@playwright/test').APIRequestContext) =>
  (await request.get(control + '/auth-counts')).json();
test.beforeEach(async ({ request }) => {
  await request.post(control + '/mode/success');
});
test('automatic warm SSO bypasses broker; valid local reload has zero authorization navigation', async ({
  page,
  request,
}) => {
  const before = await counts(request);
  await page.goto('/?view=mine');
  await expect(page.getByRole('button', { name: 'Logout' })).toBeVisible();
  await expect(page).toHaveURL(/\?view=mine$/);
  const warm = await counts(request);
  expect(warm.authorize - before.authorize).toBe(1);
  expect(warm.broker).toBe(before.broker);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Logout' })).toBeVisible();
  expect(await counts(request)).toEqual(warm);
});
test('cold automatic entry has exactly one fresh fallback, no second click', async ({
  page,
  request,
}) => {
  await request.post(control + '/mode/cold');
  const before = await counts(request);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Logout' })).toBeVisible();
  const after = await counts(request);
  expect(after.authorize - before.authorize).toBe(2);
  expect(after.silent - before.silent).toBe(1);
  expect(after.broker - before.broker).toBe(1);
  expect(after.token - before.token).toBe(1);
});
test('missing local cookie and protected 401 re-establish through current authorization', async ({
  page,
  context,
  request,
}) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Logout' })).toBeVisible();
  await expect(page.getByText('Fixture Sound', { exact: true })).toBeVisible();
  await context.clearCookies({ name: 'bg_session' });
  const before = await counts(request);
  // Exercise the application's apiFetch401 subscriber, not bare window.fetch.
  await page
    .locator('.group')
    .filter({ hasText: 'Fixture Sound' })
    .locator('button')
    .first()
    .click();
  await expect.poll(async () => (await counts(request)).authorize).toBe(before.authorize + 1);
  await expect(page.getByRole('button', { name: 'Logout' })).toBeVisible();
  const after = await counts(request);
  expect(after.broker).toBe(before.broker);
});
test('denial and session outage never auto-retry on reload', async ({ page, request }) => {
  await request.post(control + '/mode/denied');
  const before = await counts(request);
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('access was denied');
  const denied = await counts(request);
  expect(denied.authorize - before.authorize).toBe(1);
  expect(denied.broker).toBe(before.broker);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Sign in with Discord' })).toBeVisible();
  expect(await counts(request)).toEqual(denied);
  await page.route('**/api/auth/session', (route) =>
    route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"unavailable"}' })
  );
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('Unable to check');
  expect(await counts(request)).toEqual(denied);
});
test('logout reload/back and new tabs remain inert until explicit sign in', async ({
  page,
  context,
  request,
}) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Logout' })).toBeVisible();
  await page.getByRole('button', { name: 'Logout' }).click();
  await expect(page).toHaveURL(/loggedOut=1/);
  const before = await counts(request);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Sign in with Discord' })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('button', { name: 'Sign in with Discord' })).toBeVisible();
  const tab = await context.newPage();
  await tab.goto('/');
  await expect(tab.getByRole('button', { name: 'Sign in with Discord' })).toBeVisible();
  expect(await counts(request)).toEqual(before);
  await page.getByRole('button', { name: 'Sign in with Discord' }).click();
  await expect(page.getByRole('button', { name: 'Logout' })).toBeVisible();
});
