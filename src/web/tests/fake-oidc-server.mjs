import Fastify from 'fastify';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { createHash, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
export async function fakeProvider() {
  const app = Fastify();
  let { privateKey, publicKey } = await generateKeyPair('RS256');
  let jwk = { ...(await exportJWK(publicKey)), kid: 'fixture', alg: 'RS256', use: 'sig' };
  const codes = new Map();
  let issuer;
  let mode = 'success';
  app.get('/.well-known/openid-configuration', async (_req, reply) => {
    if (mode === 'discovery-error') return reply.code(503).send({ error: 'fixture' });
    return {
      issuer: mode === 'discovery-issuer' ? 'https://wrong.test/' : issuer,
      authorization_endpoint: issuer + 'authorize',
      token_endpoint: mode === 'insecure-endpoint' ? 'http://evil.test/token' : issuer + 'token',
      jwks_uri: issuer + 'jwks',
      response_types_supported: ['code'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['RS256'],
      token_endpoint_auth_methods_supported: ['client_secret_basic'],
    };
  });
  app.get('/jwks', async () => ({ keys: [jwk] }));
  app.get('/login', async (req, reply) =>
    reply.redirect(new URL(req.query.return_to, issuer).href)
  );
  app.get('/authorize', async (req, reply) => {
    const q = req.query;
    assert.equal(q.scope, 'openid profile');
    assert.equal(q.code_challenge_method, 'S256');
    assert.equal(q.client_id, 'bg');
    const callback = new URL(q.redirect_uri);
    callback.searchParams.set('state', q.state);
    if (mode === 'denied') {
      callback.searchParams.set('error', 'access_denied');
    } else {
      const code = randomUUID();
      codes.set(code, { ...q, mode });
      callback.searchParams.set('code', code);
    }
    return reply.redirect(callback.href);
  });
  app.post('/token', async (req, reply) => {
    assert.equal(
      req.headers.authorization,
      'Basic ' + Buffer.from('bg:fixture').toString('base64')
    );
    const q = new URLSearchParams(req.body);
    const tx = codes.get(q.get('code'));
    codes.delete(q.get('code'));
    if (!tx) return reply.code(400).send({ error: 'invalid_grant' });
    if (tx.mode === 'token-error')
      return reply.code(503).send({ error: 'SECRET-UPSTREAM-FAILURE' });
    assert.equal(q.get('redirect_uri'), tx.redirect_uri);
    assert.equal(
      createHash('sha256').update(q.get('code_verifier')).digest('base64url'),
      tx.code_challenge
    );
    const now = Math.floor(Date.now() / 1000);
    const claims = {
      iss: issuer,
      sub: 'fixture-user',
      aud: 'bg',
      exp: now + 120,
      iat: now,
      nonce: tx.nonce,
      name: 'Fixture User',
    };
    if (tx.mode === 'nonce') claims.nonce = 'wrong';
    if (tx.mode === 'issuer') claims.iss = 'https://wrong.test/';
    if (tx.mode === 'audience') claims.aud = 'wrong';
    if (tx.mode === 'expired') claims.exp = now - 1;
    if (tx.mode === 'missing-exp') delete claims.exp;
    if (tx.mode === 'missing-sub') delete claims.sub;
    if (tx.mode === 'missing-iat') delete claims.iat;
    if (tx.mode === 'missing-nonce') delete claims.nonce;
    let token =
      tx.mode === 'algorithm'
        ? await new SignJWT(claims)
            .setProtectedHeader({ alg: 'HS256' })
            .sign(new TextEncoder().encode('f'.repeat(32)))
        : await new SignJWT(claims)
            .setProtectedHeader({ alg: 'RS256', kid: jwk.kid })
            .sign(privateKey);
    if (tx.mode === 'signature') token = token.slice(0, -20) + 'X'.repeat(20);
    return { access_token: 'NEVER-EXPOSE-ACCESS-TOKEN', token_type: 'Bearer', id_token: token };
  });
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_req, body, done) => done(null, body)
  );
  await app.listen({ port: 0, host: '127.0.0.1' });
  issuer = app.listeningOrigin + '/';
  return {
    app,
    issuer,
    setMode: (v) => {
      mode = v;
    },
    rotate: async () => {
      ({ privateKey, publicKey } = await generateKeyPair('RS256'));
      jwk = { ...(await exportJWK(publicKey)), kid: randomUUID(), alg: 'RS256', use: 'sig' };
    },
    close: () => app.close(),
  };
}
