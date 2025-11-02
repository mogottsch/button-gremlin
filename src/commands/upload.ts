import { SlashCommandBuilder } from 'discord.js';
import type { Command } from '../types/index.js';
import { saveSoundFile, validateFileName } from '../services/storage.js';
import { extname } from 'path';

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_EXTENSIONS = ['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.webm', '.opus'];

export const upload: Command = {
  data: new SlashCommandBuilder()
    .setName('upload')
    .setDescription('Upload a new sound file')
    .addAttachmentOption((option) =>
      option
        .setName('file')
        .setDescription('The audio file to upload')
        .setRequired(true),
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const attachment = interaction.options.getAttachment('file', true);

    if (attachment.size > MAX_FILE_SIZE) {
      await interaction.editReply(
        `❌ File too large! Maximum size is ${MAX_FILE_SIZE / (1024 * 1024)}MB.`,
      );
      return;
    }

    const ext = extname(attachment.name).toLowerCase();

    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      await interaction.editReply(
        `❌ Invalid file type! Allowed formats: ${ALLOWED_EXTENSIONS.join(', ')}`,
      );
      return;
    }

    try {
      const response = await fetch(attachment.url);
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      const fileName = attachment.name;
      await saveSoundFile(fileName, buffer);
      
      const nameWithoutExt = validateFileName(fileName.replace(ext, ''));

      await interaction.editReply(
        `✅ Successfully uploaded **${nameWithoutExt}**!\nUse \`/play ${nameWithoutExt}\` to play it.`,
      );
    } catch (error) {
      console.error('Error uploading file:', error);
      await interaction.editReply('❌ Failed to upload file. Please try again.');
    }
  },
};

