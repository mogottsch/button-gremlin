import { SlashCommandBuilder } from 'discord.js';
import type { Command } from '../types/index.js';
import { disconnectFromVoiceChannel } from '../services/audio.js';

export const disconnect: Command = {
  data: new SlashCommandBuilder()
    .setName('disconnect')
    .setDescription('Disconnect the bot from the voice channel'),

  async execute(interaction) {
    if (!interaction.guildId) {
      await interaction.reply({
        content: '❌ This command can only be used in a server.',
        ephemeral: true,
      });
      return;
    }

    disconnectFromVoiceChannel(interaction.guildId);
    await interaction.reply('👋 Disconnected from voice channel.');
  },
};

