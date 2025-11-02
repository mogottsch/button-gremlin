import { FastifyPluginAsync } from 'fastify';
import { Client } from 'discord.js';
import { z } from 'zod';
import { botPlayRequestSchema, botPlayResponseSchema, botStatusSchema } from '../schemas/index.js';
import * as botService from '../services/bot-service.js';
import * as soundService from '../services/sound-service.js';

export function createBotRoutes(client: Client): FastifyPluginAsync {
  const routes: FastifyPluginAsync = async (fastify) => {
    fastify.get(
      '/status',
      {
        schema: {
          response: {
            200: botStatusSchema,
            500: z.object({ error: z.string() }),
          },
          tags: ['bot'],
          description: 'Get Discord bot status',
          security: [{ bearerAuth: [] }],
        },
      },
      async (_request, reply) => {
        try {
          const status = botService.getBotStatus(client);
          return status;
        } catch (error) {
          fastify.log.error(error);
          return reply.status(500).send({ error: 'Failed to get bot status' });
        }
      }
    );

    fastify.post(
      '/play',
      {
        schema: {
          body: botPlayRequestSchema,
          response: {
            200: botPlayResponseSchema,
            400: botPlayResponseSchema,
            404: botPlayResponseSchema,
            500: botPlayResponseSchema,
          },
          tags: ['bot'],
          description: 'Play sound in Discord',
          security: [{ bearerAuth: [] }],
        },
      },
      async (request, reply) => {
        try {
          const { soundName } = request.body as { soundName: string };

          const sound = await soundService.getSound(soundName);
          if (!sound) {
            return reply.status(404).send({ success: false, message: 'Sound not found' });
          }

          void botService.playSound(client, sound.path).catch((error) => {
            fastify.log.error({ err: error, soundName }, 'Error playing sound in background');
          });

          return {
            success: true,
            message: `Playing ${sound.displayName}`,
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to play sound';
          const statusCode = message.includes('not connected') ? 400 : 500;

          fastify.log.error(error);
          return reply.status(statusCode).send({
            success: false,
            message,
          });
        }
      }
    );

    fastify.post(
      '/disconnect',
      {
        schema: {
          response: {
            200: z.object({
              success: z.boolean(),
              message: z.string(),
            }),
            400: z.object({
              success: z.boolean(),
              message: z.string(),
            }),
            500: z.object({
              success: z.boolean(),
              message: z.string(),
            }),
          },
          tags: ['bot'],
          description: 'Disconnect from voice channel',
          security: [{ bearerAuth: [] }],
        },
      },
      async (_request, reply) => {
        try {
          botService.disconnectBot(client);
          return { success: true, message: 'Disconnected from voice channel' };
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to disconnect';
          const statusCode = message === 'Not connected to any voice channel' ? 400 : 500;

          fastify.log.error(error);
          return reply.status(statusCode).send({ success: false, message });
        }
      }
    );
  };

  return routes;
}
