import test from 'node:test';
import assert from 'node:assert/strict';
import pino from 'pino';
import { authLogOptions } from '../../logger.ts';
test('security logger strips callback query, cookies, bearer and errors', () => {
  let log = '';
  const logger = pino(
    { ...authLogOptions },
    {
      write: (s) => {
        log += s;
      },
    }
  );
  logger.info(
    {
      req: {
        method: 'GET',
        url: '/api/auth/oidc/callback?code=SECRET-CODE&state=SECRET-STATE',
        headers: {
          cookie: 'SECRET-COOKIE',
          authorization: 'SECRET-BEARER',
          'x-csrf-token': 'SECRET-CSRF',
        },
      },
      err: new Error('SECRET-ERROR'),
    },
    'fixture'
  );
  for (const secret of [
    'SECRET-CODE',
    'SECRET-STATE',
    'SECRET-COOKIE',
    'SECRET-BEARER',
    'SECRET-CSRF',
    'SECRET-ERROR',
  ])
    assert.ok(!log.includes(secret), secret);
  assert.ok(log.includes('/api/auth/oidc/callback'));
});
test('app accepts destination-backed Pino logger instance with safe request serializer', async () => {
  const { buildWebApp } = await import('../app.ts');
  let log = '';
  const logger = pino(authLogOptions, {
    write: (s) => {
      log += s;
    },
  });
  const app = await buildWebApp({
    client: {},
    authRuntime: {
      config: { insecureTest: false, automationEnabled: false, origin: 'https://fixture.test' },
      store: {},
      oidc: {},
    },
    logger,
  });
  try {
    await app.inject({ url: '/api/auth/unknown?code=SECRET-QUERY' });
    assert.ok(!log.includes('SECRET-QUERY'));
  } finally {
    await app.close();
  }
});
