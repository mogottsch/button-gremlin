import { SlashCommandBuilder, GuildMember } from 'discord.js';
import type { Command } from '../types/index.js';
import { listSoundFiles, getSoundFile } from '../services/storage.js';
import { connectToVoiceChannel, playAudioFile } from '../services/audio.js';
import { logger } from '../logger.js';

export const play: Command = {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Play a sound in your voice channel')
    .addStringOption((option) =>
      option
        .setName('sound')
        .setDescription('The sound to play')
        .setRequired(true)
        .setAutocomplete(true)
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const soundName = interaction.options.getString('sound', true);
    const member = interaction.member;

    if (!(member instanceof GuildMember)) {
      await interaction.editReply('❌ This command can only be used in a server.');
      return;
    }

    const voiceChannel = member.voice.channel;

    if (!voiceChannel) {
      await interaction.editReply('❌ You need to be in a voice channel to play sounds!');
      return;
    }

    const soundFile = await getSoundFile(soundName);

    if (!soundFile) {
      await interaction.editReply(`❌ Sound "${soundName}" not found.`);
      return;
    }

    try {
      const connection = await connectToVoiceChannel(voiceChannel);
      await interaction.editReply(`🔊 Playing **${soundFile.displayName}**...`);

      const guildId = interaction.guildId;
      if (!guildId) {
        await interaction.editReply('❌ This command can only be used in a server.');
        return;
      }

      await playAudioFile(connection, guildId, soundFile.path);
    } catch (error) {
      logger.error({ err: error, soundName, guildId: interaction.guildId }, 'Error playing sound');
      await interaction.editReply(
        '❌ Failed to play sound. Make sure the bot has proper permissions.'
      );
    }
  },

  async autocomplete(interaction) {
    const focusedValue = interaction.options.getFocused().toLowerCase();
    const soundFiles = await listSoundFiles();

    const filtered = soundFiles
      .filter((file) => file.name.toLowerCase().includes(focusedValue))
      .slice(0, 25);

    await interaction.respond(
      filtered.map((file) => ({
        name: file.displayName,
        value: file.name,
      }))
    );
  },
};
