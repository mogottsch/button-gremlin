import { Client, ClientUser, VoiceBasedChannel, Guild } from 'discord.js';
import { VoiceConnectionStatus, VoiceConnection } from '@discordjs/voice';
import {
  disconnectFromVoiceChannel,
  playAudioFile,
  getConnection,
  playSoundInChannel,
} from '../../services/audio.js';
import { logger } from '../../logger.js';

async function getGuildCandidates(guild: Guild, botUser: ClientUser): Promise<VoiceBasedChannel[]> {
  await guild.channels.fetch();

  const activeChannelIds = new Set<string>();
  for (const [userId, voiceState] of guild.voiceStates.cache) {
    if (voiceState.channel && userId !== botUser.id) {
      activeChannelIds.add(voiceState.channel.id);
    }
  }

  const candidates: VoiceBasedChannel[] = [];
  for (const channel of guild.channels.cache.values()) {
    if (channel.isVoiceBased() && activeChannelIds.has(channel.id)) {
      logger.debug({ channelId: channel.id, channelName: channel.name }, 'Checking voice channel');
      const hasPermissions = hasVoicePermissions(channel, botUser);
      logger.debug({ channelId: channel.id, hasPermissions }, 'Permission check result');
      if (hasPermissions) {
        candidates.push(channel);
      }
    }
  }

  logger.debug(
    {
      guildId: guild.id,
      channelCount: candidates.length,
      channels: candidates.map((channel) => channel.id),
    },
    'Found channels with members'
  );

  return candidates;
}

function hasVoicePermissions(channel: VoiceBasedChannel, botUser: ClientUser): boolean {
  const permissions = channel.permissionsFor(botUser);
  return permissions?.has(['Connect', 'Speak']) ?? false;
}

async function findChannelInGuild(
  guild: Guild,
  botUser: ClientUser
): Promise<VoiceBasedChannel | null> {
  const candidates = await getGuildCandidates(guild, botUser);

  for (const channel of candidates) {
    logger.info(
      { channelId: channel.id, channelName: channel.name, guildId: guild.id },
      'Found target voice channel'
    );
    return channel;
  }

  logger.warn(`No suitable voice channels found in guild ${guild.id}`);
  return null;
}

function findReadyConnection(
  client: Client,
  botUser: ClientUser
): { connection: VoiceConnection; guildId: string } | null {
  for (const guild of client.guilds.cache.values()) {
    const voiceState = guild.members.cache.get(botUser.id)?.voice;
    if (voiceState?.channel) {
      const connection = getConnection(guild.id);
      if (connection && connection.state.status === VoiceConnectionStatus.Ready) {
        return { connection, guildId: guild.id };
      }
    }
  }
  return null;
}

async function findTargetVoiceChannel(
  client: Client,
  botUser: ClientUser
): Promise<VoiceBasedChannel> {
  logger.debug({ guildCount: client.guilds.cache.size }, 'Searching for non-empty voice channels');

  for (const guild of client.guilds.cache.values()) {
    try {
      const channel = await findChannelInGuild(guild, botUser);
      if (channel) {
        return channel;
      }
    } catch (error) {
      logger.warn({ err: error, guildId: guild.id }, 'Error searching for voice channels in guild');
    }
  }

  logger.warn('No non-empty voice channels found to connect to');
  throw new Error('No non-empty voice channels found to connect to');
}

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
  const botUser = client.user;
  if (!botUser) {
    throw new Error('Bot user not available');
  }

  const readyConnection = findReadyConnection(client, botUser);

  if (readyConnection) {
    logger.info({ guildId: readyConnection.guildId, soundPath }, 'Playing audio file');
    await playAudioFile(readyConnection.connection, readyConnection.guildId, soundPath);
    logger.info({ guildId: readyConnection.guildId, soundPath }, 'Audio file playback completed');
    return;
  }

  const targetChannel = await findTargetVoiceChannel(client, botUser);
  logger.info({ channelId: targetChannel.id }, 'Connecting to voice channel');
  logger.info({ guildId: targetChannel.guild.id, soundPath }, 'Playing audio file');
  await playSoundInChannel(targetChannel, soundPath);
  logger.info({ guildId: targetChannel.guild.id, soundPath }, 'Audio file playback completed');
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
