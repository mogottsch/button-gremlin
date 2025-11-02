import { Client } from 'discord.js';
import { VoiceConnectionStatus } from '@discordjs/voice';
import {
  disconnectFromVoiceChannel,
  playAudioFile,
  getConnection,
  connectToVoiceChannel,
} from '../../services/audio.js';

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

    for (const guild of client.guilds.cache.values()) {
      try {
        await guild.members.fetch();
        await guild.channels.fetch();

        const channelsWithMembers = new Set<string>();

        for (const member of guild.members.cache.values()) {
          const voiceChannel = member.voice.channel;
          if (voiceChannel && member.id !== client.user.id) {
            channelsWithMembers.add(voiceChannel.id);
          }
        }

        for (const channel of guild.channels.cache.values()) {
          if (channel.isVoiceBased() && channelsWithMembers.has(channel.id)) {
            const botMember = guild.members.cache.get(client.user.id);
            const voiceState = botMember?.voice;
            if (!voiceState?.channel || voiceState.channel.id !== channel.id) {
              const permissions = channel.permissionsFor(client.user);
              if (permissions?.has(['Connect', 'Speak'])) {
                targetChannel = channel;
                break;
              }
            }
          }
        }

        if (targetChannel) break;
      } catch {
        continue;
      }
    }

    if (!targetChannel) {
      throw new Error('No non-empty voice channels found to connect to');
    }

    connection = await connectToVoiceChannel(targetChannel);
    guildId = targetChannel.guild.id;
  }

  if (!guildId) {
    throw new Error('No guild ID available');
  }
  await playAudioFile(connection, guildId, soundPath);
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
