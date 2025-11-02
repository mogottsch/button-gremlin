import { Client } from 'discord.js';
import { VoiceConnectionStatus } from '@discordjs/voice';
import {
  disconnectFromVoiceChannel,
  playAudioFile,
  getConnection,
  connectToVoiceChannel,
} from '../../services/audio.js';
import { logger } from '../../logger.js';

export function getBotStatus(client: Client): {
  online: boolean;
  connected: boolean;
  channelName?: string;
  guildName?: string;
} {
  const online = client.isReady();
  let connected = false;
  let channelName: string | undefined;
  let guildName: string | undefined;

  if (online && client.guilds.cache.size > 0 && client.user) {
    for (const guild of client.guilds.cache.values()) {
      const voiceState = guild.members.cache.get(client.user.id)?.voice;
      if (voiceState?.channel) {
        connected = true;
        channelName = voiceState.channel.name;
        guildName = guild.name;
        break;
      }
    }
  }

  return { online, connected, channelName, guildName };
}

export async function playSound(client: Client, soundPath: string): Promise<void> {
  if (!client.user) {
    throw new Error('Bot user not available');
  }

  let guildId: string | null = null;
  let connection = null;

  for (const guild of client.guilds.cache.values()) {
    const voiceState = guild.members.cache.get(client.user.id)?.voice;
    if (voiceState?.channel) {
      guildId = guild.id;
      connection = getConnection(guildId);
      if (connection && connection.state.status === VoiceConnectionStatus.Ready) {
        break;
      }
      connection = null;
    }
  }

  if (!connection) {
    let targetChannel = null;

    logger.debug(
      { guildCount: client.guilds.cache.size },
      'Searching for non-empty voice channels'
    );

    for (const guild of client.guilds.cache.values()) {
      try {
        await guild.channels.fetch();

        const channelsWithMembers = new Set<string>();

        const voiceStates = guild.voiceStates.cache;
        for (const [userId, voiceState] of voiceStates.entries()) {
          if (voiceState.channel && userId !== client.user.id) {
            channelsWithMembers.add(voiceState.channel.id);
          }
        }

        logger.debug(
          {
            guildId: guild.id,
            channelCount: channelsWithMembers.size,
            channels: Array.from(channelsWithMembers),
          },
          'Found channels with members'
        );

        for (const channel of guild.channels.cache.values()) {
          if (channel.isVoiceBased() && channelsWithMembers.has(channel.id)) {
            logger.debug(
              { channelId: channel.id, channelName: channel.name },
              'Checking voice channel'
            );
            const botMember = guild.members.cache.get(client.user.id);
            const voiceState = botMember?.voice;
            if (!voiceState?.channel || voiceState.channel.id !== channel.id) {
              logger.debug(
                { channelId: channel.id },
                'Bot not in this channel, checking permissions'
              );
              const permissions = channel.permissionsFor(client.user);
              const hasPermissions = permissions?.has(['Connect', 'Speak']);
              logger.debug({ channelId: channel.id, hasPermissions }, 'Permission check result');
              if (hasPermissions) {
                targetChannel = channel;
                logger.info(
                  { channelId: channel.id, channelName: channel.name, guildId: guild.id },
                  'Found target voice channel'
                );
                break;
              }
            } else {
              logger.debug({ channelId: channel.id }, 'Bot already in this channel');
            }
          }
        }

        if (targetChannel) break;
      } catch (error) {
        logger.warn(
          { err: error, guildId: guild.id },
          'Error searching for voice channels in guild'
        );
        continue;
      }
    }

    if (!targetChannel) {
      logger.warn('No non-empty voice channels found to connect to');
      throw new Error('No non-empty voice channels found to connect to');
    }

    logger.info({ channelId: targetChannel.id }, 'Connecting to voice channel');
    try {
      connection = await Promise.race([
        connectToVoiceChannel(targetChannel),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Connection timeout after 30 seconds')), 30_000)
        ),
      ]);
      guildId = targetChannel.guild.id;
      logger.info({ channelId: targetChannel.id, guildId }, 'Connected to voice channel');
    } catch (error) {
      logger.error(
        { err: error, channelId: targetChannel.id },
        'Failed to connect to voice channel'
      );
      throw error;
    }
  }

  if (!guildId) {
    throw new Error('No guild ID available');
  }

  logger.info({ guildId, soundPath }, 'Playing audio file');
  await playAudioFile(connection, guildId, soundPath);
  logger.info({ guildId, soundPath }, 'Audio file playback completed');
}

export function disconnectBot(client: Client): void {
  if (!client.user) {
    throw new Error('Bot user not available');
  }

  let disconnected = false;

  for (const guild of client.guilds.cache.values()) {
    const voiceState = guild.members.cache.get(client.user.id)?.voice;
    if (voiceState?.channel) {
      disconnectFromVoiceChannel(guild.id);
      disconnected = true;
    }
  }

  if (!disconnected) {
    throw new Error('Not connected to any voice channel');
  }
}
