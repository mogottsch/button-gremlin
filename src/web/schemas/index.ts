import { z } from 'zod';

export const authVerifySchema = z.object({
  key: z.string().min(1),
});

export const soundSchema = z.object({
  name: z.string(),
  displayName: z.string(),
  size: z.number(),
  uploadedAt: z.string().datetime(),
  tags: z.array(z.string()).default([]),
});

export const soundListSchema = z.array(soundSchema);

export const uploadResponseSchema = z.object({
  success: z.boolean(),
  sound: soundSchema.optional(),
  error: z.string().optional(),
});

export const botStatusSchema = z.object({
  online: z.boolean(),
  connected: z.boolean(),
  channelName: z.string().optional(),
  guildName: z.string().optional(),
});

export const botPlayRequestSchema = z.object({
  soundName: z.string().min(1),
});

export const botPlayResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});

export type AuthVerify = z.infer<typeof authVerifySchema>;
export type Sound = z.infer<typeof soundSchema>;
export type SoundList = z.infer<typeof soundListSchema>;
export type UploadResponse = z.infer<typeof uploadResponseSchema>;
export type BotStatus = z.infer<typeof botStatusSchema>;
export type BotPlayRequest = z.infer<typeof botPlayRequestSchema>;
export type BotPlayResponse = z.infer<typeof botPlayResponseSchema>;

export const tagsListSchema = z.array(z.string());
