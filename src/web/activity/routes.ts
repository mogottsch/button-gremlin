import type { Client, VoiceBasedChannel } from 'discord.js';
import { URL, URLSearchParams } from 'node:url';

import type { CookieSerializeOptions } from '@fastify/cookie';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AuthRuntime } from '../auth/runtime.js';
import { SESSION_SECONDS, type Identity, type Session } from '../auth/store.js';
import { strictCookies, equalSecret } from '../plugins/auth.js';
export const ACTIVITY_COOKIE = '__Secure-bg_activity';
export const DISCORD_ISSUER = 'https://discord.com';
export const snowflake = z.string().regex(/^[0-9]{17,20}$/);
export class ActivityDenied extends Error {}
export async function admittedChannel(
  client: Client,
  identity: Identity,
  admin = false
): Promise<VoiceBasedChannel> {
  const context = identity.activity;
  if (!context || identity.issuer !== DISCORD_ISSUER || !client.isReady() || !client.user)
    throw new ActivityDenied();
  const guild = client.guilds.cache.get(context.guildId);
  if (!guild) throw new ActivityDenied();
  const member = await guild.members.fetch({ user: identity.subject, force: true });
  const channel = await guild.channels.fetch(context.channelId, { force: true });
  if (
    !channel ||
    !channel.isVoiceBased() ||
    channel.guildId !== context.guildId ||
    guild.voiceStates.cache.get(identity.subject)?.channelId !== context.channelId ||
    !channel.permissionsFor(member)?.has(['ViewChannel', 'Connect']) ||
    !channel.permissionsFor(client.user)?.has(['ViewChannel', 'Connect', 'Speak']) ||
    (admin && !member.permissions.has('ManageGuild'))
  )
    throw new ActivityDenied();
  return channel;
}
export function activityCookieOptions(runtime: AuthRuntime): CookieSerializeOptions {
  const config = runtime.config.activity;
  if (!config) throw new Error('Activity disabled');
  return {
    secure: true,
    httpOnly: true,
    sameSite: 'none' as const,
    partitioned: true,
    path: '/',
    domain: new URL(config.origin).hostname,
  };
}
export function activityMutation(
  request: FastifyRequest,
  session: Session,
  runtime: AuthRuntime
): boolean {
  const csrf = request.headers['x-csrf-token'];
  return (
    request.headers.origin === runtime.config.activity?.origin &&
    typeof csrf === 'string' &&
    equalSecret(csrf, session.csrfToken)
  );
}
export function createActivityRoutes(
  runtime: AuthRuntime,
  client: Client,
  transport: typeof fetch = fetch
): FastifyPluginAsync {
  return async (app) => {
    const config = runtime.config.activity;
    if (!config) return;
    app.addHook('onRequest', async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      if (request.headers.authorization) return reply.code(401).send({ error: 'Unauthorized' });
      if (
        (request.headers.origin && request.headers.origin !== config.origin) ||
        (!['GET', 'HEAD'].includes(request.method) && request.headers.origin !== config.origin)
      )
        return reply.code(403).send({ error: 'Forbidden' });
      try {
        strictCookies(request.headers.cookie);
      } catch {
        return reply.code(400).send({ error: 'Invalid cookies' });
      }
    });
    app.get('/config', async () => ({ clientId: config.clientId, origin: config.origin }));
    app.post(
      '/exchange',
      {
        schema: {
          body: z
            .object({ code: z.string().min(1).max(2048), guildId: snowflake, channelId: snowflake })
            .strict(),
        },
      },
      async (request, reply) => {
        try {
          if (!(await runtime.store.rateLimit('activity-exchange:' + request.ip, 10, 60)))
            return reply.code(429).send({ error: 'Too many requests' });
          const { code, guildId, channelId } = request.body as {
            code: string;
            guildId: string;
            channelId: string;
          };
          // Shared atomic replay fence; only an HMAC-derived key reaches Redis.
          if (!(await runtime.store.rateLimit('activity-code:' + code, 1, 600)))
            throw new ActivityDenied();
          const tokenResponse = await transport('https://discord.com/api/oauth2/token', {
            method: 'POST',
            redirect: 'error',
            signal: globalThis.AbortSignal.timeout(5000),
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              client_id: config.clientId,
              client_secret: config.clientSecret,
              grant_type: 'authorization_code',
              code,
            }),
          });
          if (!tokenResponse.ok) throw new ActivityDenied();
          const token = z
            .object({
              access_token: z.string().min(1).max(4096),
              token_type: z.literal('Bearer'),
              expires_in: z.number().positive(),
            })
            .parse(await tokenResponse.json());
          const meResponse = await transport('https://discord.com/api/v10/oauth2/@me', {
            redirect: 'error',
            signal: globalThis.AbortSignal.timeout(5000),
            headers: { Authorization: 'Bearer ' + token.access_token },
          });
          if (!meResponse.ok) throw new ActivityDenied();
          const me = z
            .object({
              application: z.object({ id: z.literal(config.clientId) }),
              scopes: z.array(z.string()).refine((s) => s.includes('identify')),
              expires: z.string().refine((s) => Date.parse(s) > Date.now()),
              user: z.object({ id: snowflake, username: z.string() }),
            })
            .parse(await meResponse.json());
          const identity: Identity = {
            issuer: DISCORD_ISSUER,
            subject: me.user.id,
            name: me.user.username,
            activity: { guildId, channelId },
          };
          await admittedChannel(client, identity);
          const cookies = strictCookies(request.headers.cookie);
          if (cookies[ACTIVITY_COOKIE]) await runtime.store.deleteSession(cookies[ACTIVITY_COOKIE]);
          const sessionToken = await runtime.store.createSession(identity);
          reply.setCookie(ACTIVITY_COOKIE, sessionToken, {
            ...activityCookieOptions(runtime),
            maxAge: SESSION_SECONDS,
          });
          return { access_token: token.access_token };
        } catch {
          return reply
            .code(403)
            .send({ error: 'Discord authorization failed; retry in your launch voice channel' });
        }
      }
    );
    app.get('/session', async (request, reply) => {
      try {
        const token = strictCookies(request.headers.cookie)[ACTIVITY_COOKIE];
        const session = token ? await runtime.store.getSession(token) : null;
        if (!session?.identity.activity) return { authenticated: false };
        await admittedChannel(client, session.identity);
        return {
          authenticated: true,
          identity: { subject: session.identity.subject, name: session.identity.name },
          csrfToken: session.csrfToken,
          expiresAt: session.expiresAt,
        };
      } catch {
        return reply.code(403).send({ error: 'Activity admission denied' });
      }
    });
    app.post('/logout', async (request, reply) => {
      try {
        const token = strictCookies(request.headers.cookie)[ACTIVITY_COOKIE];
        const session = token ? await runtime.store.getSession(token) : null;
        if (!token || !session?.identity.activity)
          return reply.code(401).send({ error: 'Unauthorized' });
        if (!activityMutation(request, session, runtime))
          return reply.code(403).send({ error: 'Forbidden' });
        await runtime.store.deleteSession(token);
        reply.clearCookie(ACTIVITY_COOKIE, activityCookieOptions(runtime));
        return { ok: true };
      } catch {
        return reply.code(503).send({ error: 'Authentication unavailable' });
      }
    });
  };
}
