import test from 'node:test';
import assert from 'node:assert/strict';
import { readAuthConfig, safeReturnTo } from '../auth/config.ts';
const env = {
  OIDC_ISSUER: 'https://authentik.moket-home.de/application/o/button-gremlin/',
  OIDC_CLIENT_ID: 'bg',
  OIDC_CLIENT_SECRET: 'fixture',
  OIDC_REDIRECT_URI: 'https://button-gremlin.moket-home.de/api/auth/callback',
  OIDC_BROKER_BASE_URL: 'https://identity.moket-home.de',
  BUTTON_GREMLIN_APP_ORIGIN: 'https://button-gremlin.moket-home.de',
  BUTTON_GREMLIN_SESSION_SECRET: 'a'.repeat(43),
  REDIS_URL: 'redis://localhost:6379',
};
test('complete config preserves issuer and automation stays disabled', () => {
  const c = readAuthConfig(env);
  assert.equal(c.issuer, env.OIDC_ISSUER);
  assert.equal(c.automationEnabled, false);
});
test('missing config, insecure production, blank automation secret fail closed', () => {
  assert.throws(() => readAuthConfig({}));
  assert.throws(() =>
    readAuthConfig({ ...env, NODE_ENV: 'production', OIDC_ALLOW_INSECURE_TEST: 'true' })
  );
  assert.throws(() => readAuthConfig({ ...env, AUTOMATION_API_ENABLED: 'true' }));
});
test('return paths reject foreign URLs, decoded controls and auth loops', () => {
  for (const v of [
    '//evil.test',
    'https://evil.test',
    '/\\evil.test',
    '/%5cevil.test',
    '/%0a',
    '/api/auth/login',
    '/%61pi/auth/login',
  ])
    assert.throws(() => safeReturnTo(v, env.BUTTON_GREMLIN_APP_ORIGIN), v);
  assert.equal(safeReturnTo('/?a=1#b', env.BUTTON_GREMLIN_APP_ORIGIN), '/?a=1#b');
});
