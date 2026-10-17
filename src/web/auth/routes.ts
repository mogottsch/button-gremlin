import { URL } from 'node:url';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { createHash } from 'node:crypto';
import type { AuthRuntime } from './runtime.js';
import { safeReturnTo } from './config.js';
import {
  randomToken,
  SESSION_SECONDS,
  TRANSACTION_SECONDS,
  LoginInvalidated,
  type Transaction,
} from './store.js';
import {
  cookieName,
  logoutCookieName,
  strictCookies,
  requestSession,
  validMutation,
} from '../plugins/auth.js';
export const txCookieName = (state: string, insecure: boolean): string =>
  (insecure ? 'bg_oidc_tx_' : '__Secure-bg_oidc_tx_') +
  createHash('sha256').update(state).digest('hex').slice(0, 24);
const TRANSACTION_COOKIE_PATH = '/api/auth';
const validToken = (v: string | undefined): v is string => !!v && /^[A-Za-z0-9_-]{43}$/.test(v);
const browserCookieName = (insecure: boolean): string =>
  insecure ? 'bg_browser' : '__Host-bg_browser';
export function createAuthRoutes(runtime: AuthRuntime): FastifyPluginAsync {
  return async (app) => {
    const { config, store, oidc } = runtime;
    const cookieOptions = {
      httpOnly: true,
      secure: !config.insecureTest,
      sameSite: 'lax' as const,
      path: '/',
    };
    const begin = async (reply: FastifyReply, tx: Transaction): Promise<FastifyReply> => {
      const state = randomToken();
      const url = await oidc.loginUrl(state, tx);
      await store.putTransaction(state, tx);
      reply.setCookie(txCookieName(state, config.insecureTest), tx.binding, {
        ...cookieOptions,
        path: TRANSACTION_COOKIE_PATH,
        maxAge: TRANSACTION_SECONDS,
      });
      return reply.redirect(url);
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
        if (
          [...query.keys()].some((k) => !['returnTo', 'explicit'].includes(k)) ||
          query.getAll('returnTo').length > 1 ||
          query.getAll('explicit').length > 1 ||
          (query.has('explicit') && query.get('explicit') !== '1')
        )
          return reply.code(400).send({ error: 'Invalid authentication request' });
        const explicit = query.get('explicit') === '1';
        // A third-party top-level navigation must not undo local logout.
        if (explicit && request.headers['sec-fetch-site'] !== 'same-origin')
          return reply.code(403).send({ error: 'Forbidden' });
        let returnTo: string;
        try {
          returnTo = safeReturnTo(query.get('returnTo') ?? '/', config.origin);
        } catch {
          return reply.code(400).send({ error: 'Invalid return path' });
        }
        if (await requestSession(request, runtime)) return reply.redirect(config.origin + returnTo);
        const cookies = strictCookies(request.headers.cookie);
        const logoutMarker = cookies[logoutCookieName(runtime)];
        if (logoutMarker !== undefined && !validToken(logoutMarker))
          return reply.code(400).send({ error: 'Invalid authentication request' });
        if (logoutMarker && !explicit && !(await store.resumedAfterLogout(logoutMarker)))
          return reply.redirect(config.origin + '/?loggedOut=1');
        const prefix = config.insecureTest ? 'bg_oidc_tx_' : '__Secure-bg_oidc_tx_';
        if (Object.keys(cookies).filter((k) => k.startsWith(prefix)).length >= 8)
          return reply.code(429).send({ error: 'Too many pending logins' });
        const name = browserCookieName(config.insecureTest);
        const browser = validToken(cookies[name]) ? cookies[name] : randomToken();
        const browserGeneration = await store.browserGeneration(browser);
        // This marker is only a logout epoch binding, never an authentication grant.
        reply.setCookie(name, browser, { ...cookieOptions, maxAge: 30 * 86400 });
        return await begin(reply, {
          phase: 'probe',
          logoutMarker,
          explicit,
          browser,
          browserGeneration,
          binding: randomToken(),
          nonce: randomToken(),
          verifier: randomToken(),
          returnTo,
        });
      } catch {
        return reply.code(503).send({ error: 'Authentication unavailable' });
      }
    });
    app.get('/callback', async (request, reply) => {
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
        // Drop stale browser state even when Redis has already expired/consumed it.
        reply.clearCookie(name, { ...cookieOptions, path: TRANSACTION_COOKIE_PATH });
        if (!tx) return failure();
        if (tx.logoutMarker !== cookies[logoutCookieName(runtime)]) return failure();
        if (tx.logoutMarker && !tx.explicit && !(await store.resumedAfterLogout(tx.logoutMarker)))
          return failure();
        if (
          !tx.browser ||
          cookies[browserCookieName(config.insecureTest)] !== tx.browser ||
          !tx.browserGeneration
        )
          return failure();
        if (!(await store.validBrowserGeneration(tx.browser, tx.browserGeneration)))
          return failure();
        if (params.has('iss') && params.get('iss') !== config.issuer) return failure();
        if (params.has('code') && params.has('error')) return failure();
        if (
          params.get('error') === 'login_required' &&
          !params.has('code') &&
          tx.phase === 'probe'
        ) {
          if (await requestSession(request, runtime))
            return reply.redirect(config.origin + safeReturnTo(tx.returnTo, config.origin));
          return await begin(reply, {
            ...tx,
            phase: 'fallback',
            binding: randomToken(),
            nonce: randomToken(),
            verifier: randomToken(),
          });
        }
        if (params.has('error') || !params.get('code') || (params.get('code')?.length ?? 0) > 2048)
          return failure();
        // A different tab may already have completed login. Never replace its valid session.
        if (await requestSession(request, runtime))
          return reply.redirect(config.origin + safeReturnTo(tx.returnTo, config.origin));
        let identity;
        try {
          identity = await oidc.callback(url, state, tx);
        } catch {
          return failure();
        }
        const returnTo = safeReturnTo(tx.returnTo, config.origin);
        const token = await store.createSession(identity, tx);
        reply.setCookie(cookieName(runtime), token, { ...cookieOptions, maxAge: SESSION_SECONDS });
        return reply.redirect(config.origin + returnTo);
      } catch (error) {
        if (error instanceof LoginInvalidated) return failure();
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
        const cookies = strictCookies(request.headers.cookie);
        await store.logoutSession(token, cookies[browserCookieName(config.insecureTest)]);
        // Only logout writes this cookie. Neither old entry nor success responses
        // may clear it: they could arrive after this response, even from a tab
        // whose initially-cookieless browser epoch was never visible here.
        reply.setCookie(logoutCookieName(runtime), randomToken(), {
          ...cookieOptions,
          maxAge: 30 * 86400,
        });
        reply.clearCookie(cookieName(runtime), cookieOptions);
        const prefix = config.insecureTest ? 'bg_oidc_tx_' : '__Secure-bg_oidc_tx_';
        for (const name of Object.keys(cookies).filter((k) => k.startsWith(prefix)))
          reply.clearCookie(name, { ...cookieOptions, path: TRANSACTION_COOKIE_PATH });
        return { ok: true, returnTo: '/?loggedOut=1' };
      } catch {
        return reply.code(503).send({ error: 'Authentication unavailable' });
      }
    });
  };
}
