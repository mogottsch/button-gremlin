import type { FastifyInstance } from 'fastify';
import type { Client } from 'discord.js';
import type { Config } from '../types/index.js';
import { createFastifyLogger } from '../logger.js';
import { buildWebApp } from './app.js';
import type { AuthRuntime } from './auth/runtime.js';
export async function createWebServer(
  client: Client,
  port: number,
  config: Config,
  authRuntime: AuthRuntime
): Promise<FastifyInstance> {
  const app = await buildWebApp({ client, authRuntime, logger: createFastifyLogger(config) });
  try {
    await app.listen({ port, host: '0.0.0.0' });
    return app;
  } catch {
    await app.close();
    throw new Error('Web server startup failed');
  }
}
