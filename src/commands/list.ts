import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import type { Command } from '../types/index.js';
import { listSoundFiles, formatFileSize } from '../services/storage.js';

const SOUNDS_PER_PAGE = 10;

export const list: Command = {
  data: new SlashCommandBuilder()
    .setName('list')
    .setDescription('List all available sounds')
    .addIntegerOption((option) =>
      option
        .setName('page')
        .setDescription('Page number')
        .setMinValue(1)
        .setRequired(false),
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const soundFiles = await listSoundFiles();

    if (soundFiles.length === 0) {
      await interaction.editReply('📁 No sounds available. Use `/upload` to add some!');
      return;
    }

    const page = interaction.options.getInteger('page') ?? 1;
    const totalPages = Math.ceil(soundFiles.length / SOUNDS_PER_PAGE);

    if (page < 1 || page > totalPages) {
      await interaction.editReply(`❌ Invalid page number. Please choose between 1 and ${totalPages}.`);
      return;
    }

    const startIdx = (page - 1) * SOUNDS_PER_PAGE;
    const endIdx = startIdx + SOUNDS_PER_PAGE;
    const pageSounds = soundFiles.slice(startIdx, endIdx);

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('🔊 Available Sounds')
      .setDescription(
        pageSounds
          .map((file, idx) => {
            const num = startIdx + idx + 1;
            return `**${num}.** ${file.displayName} *(${formatFileSize(file.size)})*`;
          })
          .join('\n'),
      )
      .setFooter({
        text: `Page ${page} of ${totalPages} • Total: ${soundFiles.length} sound${soundFiles.length === 1 ? '' : 's'}`,
      });

    await interaction.editReply({ embeds: [embed] });
  },
};

