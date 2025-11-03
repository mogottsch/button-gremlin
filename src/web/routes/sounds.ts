import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { soundListSchema, uploadResponseSchema, tagsListSchema } from '../schemas/index.js';
import * as soundService from '../services/sound-service.js';
import {
  getAllTags,
  writeMetadata,
  addTagsToGlobal,
  getSoundFile,
  removeTagFromAll,
} from '../../services/storage.js';

const ALLOWED_TYPES = [
  'audio/mpeg',
  'audio/wav',
  'audio/ogg',
  'audio/mp4',
  'audio/flac',
  'audio/webm',
  'audio/opus',
];

const ALLOWED_EXTENSIONS = ['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.webm', '.opus'];

export function createSoundsRoutes(): FastifyPluginAsync {
  const routes: FastifyPluginAsync = async (fastify) => {
    fastify.get(
      '/',
      {
        schema: {
          response: {
            200: soundListSchema,
            500: z.object({ error: z.string() }),
          },
          tags: ['sounds'],
          description: 'List all sounds',
          security: [{ bearerAuth: [] }],
        },
      },
      async (_request, reply) => {
        try {
          const soundsData = await soundService.getAllSounds();
          const validated = soundListSchema.parse(soundsData);
          return validated;
        } catch (error) {
          fastify.log.error(error);
          return reply.status(500).send({ error: 'Failed to list sounds' });
        }
      }
    );

    fastify.get(
      '/:name/stream',
      {
        schema: {
          params: z.object({
            name: z.string(),
          }),
          response: {
            404: z.object({ error: z.string() }),
            500: z.object({ error: z.string() }),
          },
          tags: ['sounds'],
          description: 'Stream a sound file',
          security: [{ bearerAuth: [] }],
        },
      },
      async (request, reply) => {
        try {
          const { name } = request.params as { name: string };
          const sound = await soundService.getSound(name);

          if (!sound) {
            return reply.status(404).send({ error: 'Sound not found' });
          }

          const stream = soundService.createSoundStream(sound);
          reply.header('Content-Type', 'audio/mpeg');
          reply.header('Content-Length', sound.size);
          return reply.send(stream);
        } catch (error) {
          fastify.log.error(error);
          return reply.status(500).send({ error: 'Failed to stream sound' });
        }
      }
    );

    fastify.post(
      '/upload',
      {
        schema: {
          response: {
            200: uploadResponseSchema,
            400: z.object({ success: z.boolean(), error: z.string() }),
            500: z.object({ success: z.boolean(), error: z.string() }),
          },
          tags: ['sounds'],
          description: 'Upload a new sound',
          security: [{ bearerAuth: [] }],
        },
      },
      async (request, reply) => {
        try {
          const data = await request.file({
            limits: {
              fileSize: 10 * 1024 * 1024,
            },
          });

          if (!data) {
            return reply.status(400).send({ success: false, error: 'No file uploaded' });
          }

          const ext = data.filename.toLowerCase().match(/\.[^.]+$/)?.[0];
          if (
            !ALLOWED_TYPES.includes(data.mimetype) &&
            !(ext && ALLOWED_EXTENSIONS.includes(ext))
          ) {
            return reply.status(400).send({
              success: false,
              error: 'Invalid file type. Allowed: mp3, wav, ogg, m4a, flac, webm, opus',
            });
          }

          const buffer = await data.toBuffer();
          const filename = data.filename;

          const { writeFile } = await import('fs/promises');
          const filePath = `sounds/${filename}`;
          await writeFile(filePath, buffer);

          const nameWithoutExt = filename.replace(/\.[^.]+$/, '');

          // Create metadata file
          await writeMetadata(nameWithoutExt, {
            displayName: nameWithoutExt,
            filename: filename,
            tags: [],
          });

          // Ensure tags.json exists
          await addTagsToGlobal([]);

          const sound = await soundService.saveUploadedSound(nameWithoutExt);

          if (sound) {
            return {
              success: true,
              sound: {
                name: sound.name,
                displayName: sound.displayName,
                size: sound.size,
                uploadedAt: sound.uploadedAt.toISOString(),
                tags: sound.tags,
              },
            };
          } else {
            return reply.status(500).send({ success: false, error: 'Failed to save sound' });
          }
        } catch (error) {
          fastify.log.error(error);
          return reply.status(500).send({ success: false, error: 'Upload failed' });
        }
      }
    );

    fastify.delete(
      '/:name',
      {
        schema: {
          params: z.object({
            name: z.string(),
          }),
          response: {
            200: z.object({
              success: z.boolean(),
            }),
            404: z.object({ error: z.string() }),
            500: z.object({ error: z.string() }),
          },
          tags: ['sounds'],
          description: 'Delete a sound',
          security: [{ bearerAuth: [] }],
        },
      },
      async (request, reply) => {
        try {
          const { name } = request.params as { name: string };
          await soundService.deleteSound(name);
          return { success: true };
        } catch (error) {
          if (error instanceof Error && error.message === 'Sound not found') {
            return reply.status(404).send({ error: 'Sound not found' });
          }
          fastify.log.error(error);
          return reply.status(500).send({ error: 'Failed to delete sound' });
        }
      }
    );

    fastify.get(
      '/tags',
      {
        schema: {
          response: {
            200: tagsListSchema,
            500: z.object({ error: z.string() }),
          },
          tags: ['sounds'],
          description: 'Get all available tags',
          security: [{ bearerAuth: [] }],
        },
      },
      async (_request, reply) => {
        try {
          const tags = await getAllTags();
          return tags;
        } catch (error) {
          fastify.log.error(error);
          return reply.status(500).send({ error: 'Failed to get tags' });
        }
      }
    );

    fastify.post(
      '/tags',
      {
        schema: {
          body: z.object({
            tag: z.string(),
          }),
          response: {
            200: z.object({ success: z.boolean() }),
            400: z.object({ error: z.string() }),
            500: z.object({ error: z.string() }),
          },
          tags: ['sounds'],
          description: 'Create a new tag',
          security: [{ bearerAuth: [] }],
        },
      },
      async (request, reply) => {
        try {
          const { tag } = request.body as { tag: string };
          const trimmedTag = tag.trim().toLowerCase();

          if (!trimmedTag) {
            return reply.status(400).send({ error: 'Tag name cannot be empty' });
          }

          const existingTags = await getAllTags();
          if (existingTags.includes(trimmedTag)) {
            return reply.status(400).send({ error: 'Tag already exists' });
          }

          await addTagsToGlobal([trimmedTag]);
          return { success: true };
        } catch (error) {
          fastify.log.error(error);
          return reply.status(500).send({ error: 'Failed to create tag' });
        }
      }
    );

    fastify.delete(
      '/tags/:tag',
      {
        schema: {
          params: z.object({
            tag: z.string(),
          }),
          response: {
            200: z.object({ success: z.boolean() }),
            404: z.object({ error: z.string() }),
            500: z.object({ error: z.string() }),
          },
          tags: ['sounds'],
          description: 'Delete a tag and remove it from all sounds',
          security: [{ bearerAuth: [] }],
        },
      },
      async (request, reply) => {
        try {
          const { tag } = request.params as { tag: string };
          const existingTags = await getAllTags();

          if (!existingTags.includes(tag)) {
            return reply.status(404).send({ error: 'Tag not found' });
          }

          await removeTagFromAll(tag);
          return { success: true };
        } catch (error) {
          fastify.log.error(error);
          return reply.status(500).send({ error: 'Failed to delete tag' });
        }
      }
    );

    fastify.patch(
      '/:name/metadata',
      {
        schema: {
          params: z.object({
            name: z.string(),
          }),
          body: z.object({
            displayName: z.string().optional(),
            tags: z.array(z.string()).optional(),
          }),
          response: {
            200: z.object({ success: z.boolean() }),
            404: z.object({ error: z.string() }),
            500: z.object({ error: z.string() }),
          },
          tags: ['sounds'],
          description: 'Update sound metadata',
          security: [{ bearerAuth: [] }],
        },
      },
      async (request, reply) => {
        try {
          const { name } = request.params as { name: string };
          const body = request.body as { displayName?: string; tags?: string[] };

          const sound = await getSoundFile(name);
          if (!sound) {
            return reply.status(404).send({ error: 'Sound not found' });
          }

          const ext = sound.path.match(/\.[^.]+$/)?.[0] ?? '';
          const currentMetadata = {
            displayName: sound.displayName,
            filename: sound.name + ext,
            tags: sound.tags,
          };

          const newMetadata = {
            ...currentMetadata,
            ...(body.displayName && { displayName: body.displayName }),
            ...(body.tags && { tags: body.tags }),
          };

          await writeMetadata(name, newMetadata);

          if (body.tags) {
            await addTagsToGlobal(body.tags);
          }

          return { success: true };
        } catch (error) {
          fastify.log.error(error);
          return reply.status(500).send({ error: 'Failed to update metadata' });
        }
      }
    );
  };

  return routes;
}
