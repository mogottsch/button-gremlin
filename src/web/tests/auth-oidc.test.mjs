import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeProvider } from './fake-oidc-server.mjs';
import { OidcRuntime } from '../auth/oidc.ts';
import { randomToken } from '../auth/store.ts';
test('real signed OIDC round trip enforces PKCE nonce issuer audience signature required claims', async () => {
  const p = await fakeProvider();
  const config = {
    issuer: p.issuer,
    origin: 'http://127.0.0.1:3000',
    redirectUri: 'http://127.0.0.1:3000/api/auth/callback',
    brokerBase: p.issuer.slice(0, -1),
    clientId: 'bg',
    clientSecret: 'fixture',
    insecureTest: true,
  };
  try {
    const oidc = await OidcRuntime.create(config);
    for (const mode of [
      'success',
      'rotate',
      'nonce',
      'issuer',
      'audience',
      'expired',
      'missing-exp',
      'missing-sub',
      'missing-iat',
      'missing-nonce',
      'signature',
      'algorithm',
      'token-error',
    ]) {
      p.setMode(mode);
      if (mode === 'rotate') await p.rotate();
      const state = randomToken();
      const tx = { nonce: randomToken(), verifier: randomToken(), binding: 'b', returnTo: '/' };
      let r = await fetch(await oidc.loginUrl(state, tx), { redirect: 'manual' });
      r = await fetch(new URL(r.headers.get('location'), p.issuer), { redirect: 'manual' });
      const cb = new URL(r.headers.get('location'));
      if (mode === 'success' || mode === 'rotate') {
        await assert.rejects(() => oidc.callback(cb, randomToken(), tx));
        const missing = new URL(cb);
        missing.searchParams.delete('state');
        await assert.rejects(() => oidc.callback(missing, state, tx));
        const foreign = new URL(cb);
        foreign.host = 'evil.test';
        await assert.rejects(() => oidc.callback(foreign, state, tx));
        const identity = await oidc.callback(cb, state, tx);
        assert.equal(identity.subject, 'fixture-user');
        assert.equal(identity.issuer, p.issuer);
        assert.ok(!JSON.stringify(identity).includes('TOKEN'));
        await assert.rejects(() => oidc.callback(cb, state, tx));
      } else await assert.rejects(() => oidc.callback(cb, state, tx), mode);
    }
  } finally {
    await p.close();
  }
});
test('discovery issuer/endpoints fail closed and failure is not permanently cached', async () => {
  const p = await fakeProvider();
  const config = {
    issuer: p.issuer,
    origin: 'http://127.0.0.1:3000',
    redirectUri: 'http://127.0.0.1:3000/api/auth/callback',
    brokerBase: p.issuer.slice(0, -1),
    clientId: 'bg',
    clientSecret: 'fixture',
    insecureTest: true,
  };
  try {
    for (const mode of ['discovery-error', 'discovery-issuer', 'insecure-endpoint']) {
      p.setMode(mode);
      await assert.rejects(() => OidcRuntime.create(config));
    }
    p.setMode('success');
    for (const field of [
      'authorization_endpoint',
      'token_endpoint',
      'jwks_uri',
      'userinfo_endpoint',
    ]) {
      for (const endpoint of [
        'https://foreign.test/endpoint',
        'https://127.0.0.1/endpoint',
        'https://10.0.0.1/endpoint',
        'https://169.254.169.254/endpoint',
        'https://[::1]/endpoint',
      ]) {
        p.setEndpoints({ [field]: endpoint });
        await assert.rejects(() => OidcRuntime.create(config), field + ': ' + endpoint);
      }
    }
    p.setEndpoints({});
    assert.ok(await OidcRuntime.create(config));
    await assert.rejects(() => OidcRuntime.create({ ...config, insecureTest: false }));
    const previousEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      await assert.rejects(() => OidcRuntime.create(config), /Insecure test mode forbidden/);
    } finally {
      if (previousEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousEnv;
    }
  } finally {
    await p.close();
  }
});
