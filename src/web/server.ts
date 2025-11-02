import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { Client } from 'discord.js';
import path from 'path';
import { existsSync } from 'fs';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { createAuthPlugin } from './plugins/auth.js';
import { createSoundsRoutes } from './routes/sounds.js';
import { createBotRoutes } from './routes/bot.js';
import { createAuthRoutes } from './routes/auth.js';
import { createFastifyLogger } from '../logger.js';
import type { Config } from '../types/index.js';

export async function createWebServer(
  client: Client,
  apiKey: string,
  port: number,
  config: Config
): Promise<void> {
  const fastifyLogger = createFastifyLogger(config);

  const app = Fastify({
    logger: fastifyLogger,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });
  await app.register(multipart);

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Button Gremlin API',
        description: 'Discord soundboard bot API',
        version: '0.1.0',
      },
      servers: [
        {
          url: '/',
        },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
          },
        },
      },
    },
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
  });

  await app.register(createAuthRoutes(apiKey), { prefix: '/api/auth' });

  await app.register(async (fastify) => {
    await fastify.register(createAuthPlugin(apiKey));
    await fastify.register(createSoundsRoutes(), { prefix: '/api/sounds' });
    await fastify.register(createBotRoutes(client), { prefix: '/api/bot' });
  });

  const webDistPath = path.join(process.cwd(), 'web/dist');

  if (existsSync(webDistPath)) {
    await app.register(fastifyStatic, {
      root: webDistPath,
      prefix: '/',
    });

    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api')) {
        return reply.code(404).send({ error: 'Not found' });
      }
      return reply.sendFile('index.html');
    });
  } else {
    app.log.warn(
      { webDistPath },
      'Frontend dist not found - build the frontend with "cd web && pnpm build"'
    );
  }

  try {
    await app.listen({ port, host: '0.0.0.0' });
    app.log.info({ port }, 'Web server started');
    app.log.info({ port }, 'Frontend available');
    app.log.info({ port, docsPath: '/docs' }, 'API docs available');
  } catch (err) {
    app.log.error({ err }, 'Failed to start web server');
    process.exit(1);
  }
}
