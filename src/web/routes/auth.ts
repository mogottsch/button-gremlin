import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { authVerifySchema } from '../schemas/index.js';

export function createAuthRoutes(apiKey: string): FastifyPluginAsync {
  const routes: FastifyPluginAsync = async (fastify) => {
    fastify.withTypeProvider().post(
      '/verify',
      {
        schema: {
          body: authVerifySchema,
          response: {
            200: z.object({
              valid: z.boolean(),
            }),
            401: z.object({
              valid: z.boolean(),
              error: z.string().optional(),
            }),
          },
          tags: ['auth'],
          description: 'Verify API key',
        },
      },
      async (request, reply) => {
        const { key } = request.body as { key: string };

        if (key === apiKey) {
          return { valid: true };
        } else {
          return reply.status(401).send({ valid: false, error: 'Invalid API key' });
        }
      }
    );
  };

  return routes;
}
