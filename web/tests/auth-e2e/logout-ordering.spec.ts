import { test, expect } from '@playwright/test';

for (const ordering of ['entry', 'success']) {
  test(`backend logout survives browser-delivered delayed ${ordering} headers`, async ({
    page,
    context,
    request,
  }) => {
    await request.post('http://127.0.0.1:13001/mode/success');
    const late = await context.newPage();
    let ready!: () => void;
    let release!: () => void;
    const fetched = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const withheld = new Promise<void>((resolve) => {
      release = resolve;
    });
    let deliverSuccess: (() => Promise<unknown>) | undefined;
    if (ordering === 'entry') {
      await late.route('**/api/auth/login?**', async (route) => {
        // Use the isolated request fixture: context-bound route.fetch would
        // install its Set-Cookie early and not reproduce unseen headers.
        const response = await request.fetch(route.request(), { maxRedirects: 0 });
        expect(response.status()).toBe(302);
        ready();
        await withheld;
        await route.fulfill({ response });
      });
    } else {
      // Obtain real backend success in a separate, initially cookieless jar.
      // Replay that actual HTTP response to the browser ONLY after logout.
      // page.route cannot pause a callback inside an HTTP redirect chain.
      const entry = await request.get('http://127.0.0.1:13000/api/auth/login', { maxRedirects: 0 });
      const provider = await request.get(entry.headers().location, { maxRedirects: 0 });
      const success = await request.get(provider.headers().location, { maxRedirects: 0 });
      expect(success.headers()['set-cookie']).toContain('bg_session=');
      await late.route('**/delayed-success', (route) => route.fulfill({ response: success }));
      deliverSuccess = () => late.goto('/delayed-success');
    }
    try {
      if (ordering === 'entry') {
        await late.goto('/');
        await fetched;
      }
      expect(await context.cookies()).toEqual([]); // unseen B response really is withheld
      await page.goto('/');
      await expect(page.getByRole('button', { name: 'Logout' })).toBeVisible();
      await page.getByRole('button', { name: 'Logout' }).click();
      await expect(page).toHaveURL(/loggedOut=1/);
      const marker = (await context.cookies()).find((c) => c.name === 'bg_logout');
      expect(marker?.httpOnly).toBe(true);
      expect(marker?.path).toBe('/');
      release();
      if (deliverSuccess) await deliverSuccess();
      await expect(late.getByRole('button', { name: 'Sign in with Discord' })).toBeVisible();
      expect((await context.cookies()).find((c) => c.name === 'bg_logout')?.value).toBe(
        marker?.value
      );
      const session = await context.request.get('/api/auth/session');
      expect(session.ok()).toBe(true);
      expect(await session.json()).toEqual({ authenticated: false });
      expect((await context.request.get('/api/sounds')).status()).toBe(401);
      await late.reload();
      await expect(late.getByRole('button', { name: 'Sign in with Discord' })).toBeVisible();
      await page.getByRole('button', { name: 'Sign in with Discord' }).click();
      await expect(page.getByRole('button', { name: 'Logout' })).toBeVisible();
      expect((await context.cookies()).find((c) => c.name === 'bg_logout')?.value).toBe(
        marker?.value
      );
    } finally {
      release();
      await late.close();
    }
  });
}
