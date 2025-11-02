import { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';

export function createAuthPlugin(apiKey: string): FastifyPluginAsync {
  const plugin: FastifyPluginAsync = async (fastify) => {
    fastify.addHook('onRequest', async (request, reply) => {
      const authHeader = request.headers.authorization;

      if (!authHeader?.startsWith('Bearer ')) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const token = authHeader.substring(7);

      if (token !== apiKey) {
        return reply.status(401).send({ error: 'Invalid API key' });
      }
    });
  };

  return fp(plugin, { name: 'auth' });
}
