import { URL } from 'node:url';
import Fastify, { type FastifyServerOptions, type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { Client } from 'discord.js';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { z } from 'zod';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
  jsonSchemaTransform,
} from 'fastify-type-provider-zod';
import { authGate } from './plugins/auth.js';
import { createSoundsRoutes } from './routes/sounds.js';
import { createBotRoutes } from './routes/bot.js';
import { createAuthRoutes } from './auth/routes.js';
import { createActivityRoutes } from './activity/routes.js';
import type { AuthRuntime } from './auth/runtime.js';
export async function buildWebApp({
  client,
  authRuntime,
  logger = false,
  botService,
  activityFetch,
  webDistPath = path.join(process.cwd(), 'web/dist'),
}: {
  client: Client;
  authRuntime: AuthRuntime;
  logger?: FastifyServerOptions['logger'];
  webDistPath?: string;
  botService?: typeof import('./services/bot-service.js');
  activityFetch?: typeof fetch;
}): Promise<FastifyInstance> {
  if (authRuntime.config.insecureTest && process.env['NODE_ENV'] === 'production')
    throw new Error('Insecure test mode forbidden');
  if (authRuntime.config.automationEnabled && !authRuntime.config.automationKey.trim())
    throw new Error('Automation secret required');
  const options: FastifyServerOptions =
    logger && typeof logger === 'object' && 'child' in logger
      ? { loggerInstance: logger as NonNullable<FastifyServerOptions['loggerInstance']> }
      : { logger };
  const app = Fastify(options).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(cookie);
  app.addHook('onRequest', authGate(authRuntime, client));
  app.addHook('onRoute', (route) => {
    if (route.url.startsWith('/api/sounds') || route.url.startsWith('/api/bot')) {
      route.schema = {
        ...route.schema,
        security: authRuntime.config.automationEnabled
          ? [{ sessionAuth: [] }, { bearerAuth: [] }]
          : [{ sessionAuth: [] }],
        response: {
          ...(route.schema?.response as Record<string, unknown> | undefined),
          401: z.object({ error: z.string() }),
          403: z.object({ error: z.string() }),
          429: z.object({ error: z.string() }),
          503: z.object({ error: z.string() }),
        },
      };
    }
  });
  await app.register(multipart);
  await app.register(swagger, {
    transform: jsonSchemaTransform,
    openapi: {
      info: {
        title: 'Button Gremlin API',
        description: 'Discord soundboard bot API',
        version: '0.1.0',
      },
      components: {
        securitySchemes: {
          sessionAuth: { type: 'apiKey', in: 'cookie', name: '__Host-bg_session' },
          bearerAuth: { type: 'http', scheme: 'bearer' },
        },
      },
    },
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });
  await app.register(createAuthRoutes(authRuntime), { prefix: '/api/auth' });
  await app.register(createActivityRoutes(authRuntime, client, activityFetch), {
    prefix: '/api/activity',
  });
  await app.register(createSoundsRoutes(), { prefix: '/api/sounds' });
  await app.register(createBotRoutes(client, botService), { prefix: '/api/bot' });
  if (existsSync(webDistPath))
    await app.register(fastifyStatic, { root: webDistPath, prefix: '/' });
  app.setNotFoundHandler((request, reply) => {
    if (
      new URL(request.url, 'http://internal').pathname.startsWith('/api') ||
      !existsSync(webDistPath)
    )
      return reply.code(404).send({ error: 'Not found' });
    return reply.sendFile('index.html');
  });
  await app.ready();
  return app;
}
