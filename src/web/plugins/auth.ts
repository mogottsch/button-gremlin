import { URL } from 'node:url';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { AuthRuntime } from '../auth/runtime.js';
import type { Session } from '../auth/store.js';
import type { Client, VoiceBasedChannel } from 'discord.js';
import {
  ACTIVITY_COOKIE,
  admittedChannel,
  activityMutation,
  ActivityDenied,
} from '../activity/routes.js';
declare module 'fastify' {
  interface FastifyRequest {
    activityChannel?: VoiceBasedChannel;
  }
}
export function cookieName(runtime: AuthRuntime): string {
  return runtime.config.insecureTest ? 'bg_session' : '__Host-bg_session';
}
export function equalSecret(a: string, b: string): boolean {
  return timingSafeEqual(
    createHash('sha256').update(a).digest(),
    createHash('sha256').update(b).digest()
  );
}
export function strictCookies(header: string | undefined): Record<string, string> {
  const values: Record<string, string> = {};
  if (!header) return values;
  if (header.length > 16384) throw new Error('Invalid cookies');
  for (const item of header.split(';')) {
    const i = item.indexOf('=');
    if (i < 1) throw new Error('Invalid cookie');
    const key = item.slice(0, i).trim();
    if (Object.hasOwn(values, key)) throw new Error('Duplicate cookie');
    values[key] = decodeURIComponent(item.slice(i + 1).trim());
  }
  return values;
}
export async function requestSession(
  request: FastifyRequest,
  runtime: AuthRuntime
): Promise<Session | null> {
  const token = strictCookies(request.headers.cookie)[cookieName(runtime)];
  const session = token ? await runtime.store.getSession(token) : null;
  return session?.identity.activity ? null : session;
}
export function validMutation(
  request: FastifyRequest,
  session: Session,
  runtime: AuthRuntime
): boolean {
  const csrf = request.headers['x-csrf-token'];
  return (
    request.headers.origin === runtime.config.origin &&
    typeof csrf === 'string' &&
    equalSecret(csrf, session.csrfToken)
  );
}
export function authGate(
  runtime: AuthRuntime,
  client: Client
): (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply | undefined> {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const rawPath = new URL(request.url, 'http://internal').pathname;
    const path =
      request.routeOptions.url === '/*' ? rawPath : (request.routeOptions.url ?? rawPath);
    if (
      !(
        path === '/api/sounds' ||
        path.startsWith('/api/sounds/') ||
        path === '/api/bot' ||
        path.startsWith('/api/bot/') ||
        path === '/docs' ||
        path.startsWith('/docs/')
      )
    )
      return;
    reply.header('Cache-Control', 'no-store');
    try {
      let cookies: Record<string, string>;
      try {
        cookies = strictCookies(request.headers.cookie);
      } catch {
        return reply.code(401).send({ error: 'Unauthorized' });
      }
      const authorization = request.headers.authorization;
      const activityToken = cookies[ACTIVITY_COOKIE];
      if (activityToken) {
        if (
          !runtime.config.activity ||
          authorization ||
          cookies[cookieName(runtime)] ||
          path.startsWith('/docs')
        )
          return reply.code(401).send({ error: 'Unauthorized' });
        if (request.headers.origin && request.headers.origin !== runtime.config.activity.origin)
          return reply.code(403).send({ error: 'Forbidden' });
        const session = await runtime.store.getSession(activityToken);
        if (!session?.identity.activity) return reply.code(401).send({ error: 'Unauthorized' });
        if (
          !['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
          !activityMutation(request, session, runtime)
        )
          return reply.code(403).send({ error: 'Forbidden' });
        try {
          request.activityChannel = await admittedChannel(
            client,
            session.identity,
            path.startsWith('/api/sounds') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method)
          );
        } catch {
          throw new ActivityDenied();
        }
        return;
      }
      if (authorization) {
        if (
          cookies[cookieName(runtime)] ||
          path.startsWith('/docs') ||
          !runtime.config.automationEnabled
        )
          return reply.code(401).send({ error: 'Unauthorized' });
        if (request.headers.origin && request.headers.origin !== runtime.config.origin)
          return reply.code(403).send({ error: 'Forbidden' });
        if (
          !authorization.startsWith('Bearer ') ||
          !equalSecret(authorization.slice(7), runtime.config.automationKey)
        ) {
          if (!(await runtime.store.rateLimit('automation:' + request.ip, 30, 60)))
            return reply.code(429).send({ error: 'Too many requests' });
          return reply.code(401).send({ error: 'Unauthorized' });
        }
        return;
      }
      const token = cookies[cookieName(runtime)];
      const session = token ? await runtime.store.getSession(token) : null;
      if (!session || session.identity.activity)
        return reply.code(401).send({ error: 'Unauthorized' });
      if (
        !['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
        !validMutation(request, session, runtime)
      )
        return reply.code(403).send({ error: 'Forbidden' });
    } catch (error) {
      if (error instanceof ActivityDenied)
        return reply.code(403).send({ error: 'Activity admission denied' });
      return reply.code(503).send({ error: 'Authentication unavailable' });
    }
  };
}
