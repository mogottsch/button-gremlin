import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/auth-e2e',
  workers: 1,
  fullyParallel: false,
  use: { baseURL: 'http://127.0.0.1:13000', headless: true },
  webServer: {
    command: 'pnpm exec tsx src/web/tests/e2e-app.mjs',
    cwd: '..',
    url: 'http://127.0.0.1:13000/api/auth/session',
    reuseExistingServer: false,
    timeout: 30000,
  },
  reporter: 'list',
});
