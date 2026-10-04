import { URL } from 'node:url';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { createHash } from 'node:crypto';
import type { AuthRuntime } from './runtime.js';
import { safeReturnTo } from './config.js';
import { randomToken, SESSION_SECONDS, TRANSACTION_SECONDS } from './store.js';
import { cookieName, strictCookies, requestSession, validMutation } from '../plugins/auth.js';
export const txCookieName = (state: string, insecure: boolean): string =>
  (insecure ? 'bg_oidc_tx_' : '__Secure-bg_oidc_tx_') +
  createHash('sha256').update(state).digest('hex').slice(0, 24);
const CALLBACK = '/api/auth/oidc/callback';
export function createAuthRoutes(runtime: AuthRuntime): FastifyPluginAsync {
  return async (app) => {
    const { config, store, oidc } = runtime;
    const cookieOptions = {
      httpOnly: true,
      secure: !config.insecureTest,
      sameSite: 'lax' as const,
      path: '/',
    };
    app.addHook('onRequest', async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      if (request.headers.authorization) return reply.code(401).send({ error: 'Unauthorized' });
      try {
        strictCookies(request.headers.cookie);
      } catch {
        return reply.code(400).send({ error: 'Invalid authentication request' });
      }
    });
    app.get('/login', async (request, reply) => {
      try {
        if (!(await store.rateLimit('login:' + request.ip, 30, 60)))
          return reply.code(429).send({ error: 'Too many requests' });
        const query = new URL(request.url, config.origin).searchParams;
        if ([...query.keys()].some((k) => k !== 'returnTo') || query.getAll('returnTo').length > 1)
          return reply.code(400).send({ error: 'Invalid authentication request' });
        let returnTo: string;
        try {
          returnTo = safeReturnTo(query.get('returnTo') ?? '/', config.origin);
        } catch {
          return reply.code(400).send({ error: 'Invalid return path' });
        }
        const cookies = strictCookies(request.headers.cookie);
        const prefix = config.insecureTest ? 'bg_oidc_tx_' : '__Secure-bg_oidc_tx_';
        if (Object.keys(cookies).filter((k) => k.startsWith(prefix)).length >= 8)
          return reply.code(429).send({ error: 'Too many pending logins' });
        const state = randomToken();
        const tx = {
          binding: randomToken(),
          nonce: randomToken(),
          verifier: randomToken(),
          returnTo,
        };
        const url = await oidc.loginUrl(state, tx);
        await store.putTransaction(state, tx);
        reply.setCookie(txCookieName(state, config.insecureTest), tx.binding, {
          ...cookieOptions,
          path: CALLBACK,
          maxAge: TRANSACTION_SECONDS,
        });
        return reply.redirect(url);
      } catch {
        return reply.code(503).send({ error: 'Authentication unavailable' });
      }
    });
    app.get('/oidc/callback', async (request, reply) => {
      const failure = (): FastifyReply =>
        reply.redirect(config.origin + '/?authError=login_failed');
      try {
        if (!(await store.rateLimit('callback:' + request.ip, 60, 60)))
          return reply.code(429).send({ error: 'Too many requests' });
        const url = new URL(config.redirectUri);
        url.search = new URL(request.url, config.origin).search;
        const params = url.searchParams;
        if (
          [...params.keys()].some(
            (k) =>
              ![
                'state',
                'code',
                'error',
                'error_description',
                'error_uri',
                'iss',
                'session_state',
              ].includes(k) || params.getAll(k).length !== 1
          )
        )
          return failure();
        const state = params.get('state');
        if (!state || !/^[A-Za-z0-9_-]{43}$/.test(state)) return failure();
        const name = txCookieName(state, config.insecureTest);
        const cookies = strictCookies(request.headers.cookie);
        const binding = cookies[name];
        if (!binding || !/^[A-Za-z0-9_-]{43}$/.test(binding)) return failure();
        const tx = await store.takeTransaction(state, binding);
        if (!tx) return failure();
        reply.clearCookie(name, { ...cookieOptions, path: CALLBACK });
        if (params.has('error') || !params.get('code') || (params.get('code')?.length ?? 0) > 2048)
          return failure();
        let identity;
        try {
          identity = await oidc.callback(url, state, tx);
        } catch {
          return failure();
        }
        const returnTo = safeReturnTo(tx.returnTo, config.origin);
        const previous = cookies[cookieName(runtime)];
        if (previous) await store.deleteSession(previous);
        const token = await store.createSession(identity);
        reply.setCookie(cookieName(runtime), token, { ...cookieOptions, maxAge: SESSION_SECONDS });
        return reply.redirect(config.origin + returnTo);
      } catch {
        return reply.code(503).send({ error: 'Authentication unavailable' });
      }
    });
    app.get('/session', async (request, reply) => {
      try {
        const session = await requestSession(request, runtime);
        if (!session) return { authenticated: false };
        const { subject, name, avatarUrl } = session.identity;
        return {
          authenticated: true,
          identity: { subject, name, ...(avatarUrl ? { avatarUrl } : {}) },
          csrfToken: session.csrfToken,
        };
      } catch {
        return reply.code(503).send({ error: 'Authentication unavailable' });
      }
    });
    app.post('/logout', async (request, reply) => {
      try {
        const session = await requestSession(request, runtime);
        if (!session) return reply.code(401).send({ error: 'Unauthorized' });
        if (!validMutation(request, session, runtime))
          return reply.code(403).send({ error: 'Forbidden' });
        const token = strictCookies(request.headers.cookie)[cookieName(runtime)];
        if (!token) return reply.code(401).send({ error: 'Unauthorized' });
        await store.deleteSession(token);
        reply.clearCookie(cookieName(runtime), cookieOptions);
        return { ok: true };
      } catch {
        return reply.code(503).send({ error: 'Authentication unavailable' });
      }
    });
  };
}
