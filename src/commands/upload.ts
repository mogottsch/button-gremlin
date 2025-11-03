import { SlashCommandBuilder } from 'discord.js';
import type { Command } from '../types/index.js';
import { saveSoundFile, writeMetadata, addTagsToGlobal } from '../services/storage.js';
import { normalizeFileName, validateFileName } from '../utils/filename.js';
import { extname } from 'path';
import { logger } from '../logger.js';

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_EXTENSIONS = ['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.webm', '.opus'];

export const upload: Command = {
  data: new SlashCommandBuilder()
    .setName('upload')
    .setDescription('Upload a new sound file')
    .addAttachmentOption((option) =>
      option.setName('file').setDescription('The audio file to upload').setRequired(true)
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const attachment = interaction.options.getAttachment('file', true);

    if (attachment.size > MAX_FILE_SIZE) {
      await interaction.editReply(
        `❌ File too large! Maximum size is ${MAX_FILE_SIZE / (1024 * 1024)}MB.`
      );
      return;
    }

    const ext = extname(attachment.name).toLowerCase();

    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      await interaction.editReply(
        `❌ Invalid file type! Allowed formats: ${ALLOWED_EXTENSIONS.join(', ')}`
      );
      return;
    }

    try {
      const response = await fetch(attachment.url);
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      const fileName = attachment.name;
      await saveSoundFile(fileName, buffer);

      const ext = extname(fileName).toLowerCase();
      const originalNameWithoutExt = fileName.replace(ext, '');

      // Normalize the filename to create the internal name and initial display name
      const normalizedName = normalizeFileName(originalNameWithoutExt);
      const nameWithoutExt = validateFileName(normalizedName);

      // Create metadata file with normalized display name
      await writeMetadata(nameWithoutExt, {
        displayName: normalizedName,
        filename: nameWithoutExt + ext,
        tags: [],
      });

      // Ensure tags.json exists with empty array
      await addTagsToGlobal([]);

      await interaction.editReply(
        `✅ Successfully uploaded **${normalizedName}**!\nUse \`/play ${nameWithoutExt}\` to play it.`
      );
      logger.info({ fileName: nameWithoutExt }, 'Sound file uploaded successfully');
    } catch (error) {
      logger.error({ err: error, fileName: attachment.name }, 'Error uploading file');
      await interaction.editReply('❌ Failed to upload file. Please try again.');
    }
  },
};
