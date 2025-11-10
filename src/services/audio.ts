import {
  joinVoiceChannel,
  VoiceConnection,
  VoiceConnectionStatus,
  entersState,
  createAudioPlayer,
  createAudioResource,
  AudioPlayer,
  AudioPlayerStatus,
  AudioResource,
  NoSubscriberBehavior,
} from '@discordjs/voice';
import { VoiceBasedChannel } from 'discord.js';
import { createReadStream } from 'fs';
import { getConfig } from '../config.js';
import logger from '../logger.js';

const connections = new Map<string, VoiceConnection>();
const players = new Map<string, AudioPlayer>();
const idleTimers = new Map<string, ReturnType<typeof setTimeout>>();
let idleTimeoutLoaded = false;
let cachedIdleDisconnectTimeoutMs: number | undefined;

function getIdleDisconnectTimeoutMs(): number | undefined {
  if (!idleTimeoutLoaded) {
    cachedIdleDisconnectTimeoutMs = getConfig().voice.idleDisconnectTimeoutMs;
    idleTimeoutLoaded = true;
  }

  return cachedIdleDisconnectTimeoutMs;
}

function clearIdleDisconnect(guildId: string): void {
  const existing = idleTimers.get(guildId);

  if (existing) {
    clearTimeout(existing);
    idleTimers.delete(guildId);
  }
}

function scheduleIdleDisconnect(guildId: string): void {
  const timeoutMs = getIdleDisconnectTimeoutMs();

  if (!timeoutMs) {
    return;
  }

  clearIdleDisconnect(guildId);

  const timeout = setTimeout(() => {
    disconnectFromVoiceChannel(guildId);
  }, timeoutMs);

  idleTimers.set(guildId, timeout);
}

export function getConnection(guildId: string): VoiceConnection | undefined {
  return connections.get(guildId);
}

export function getAllConnections(): Map<string, VoiceConnection> {
  return connections;
}

function scheduleIdleDisconnectIfIdle(guildId: string): void {
  const player = players.get(guildId);
  if (!player || player.state.status === AudioPlayerStatus.Idle) {
    scheduleIdleDisconnect(guildId);
  }
}

async function handleDisconnected(connection: VoiceConnection, guildId: string): Promise<void> {
  try {
    await Promise.race([
      entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
      entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
    ]);
  } catch {
    connection.destroy();
    connections.delete(guildId);
    players.delete(guildId);
    clearIdleDisconnect(guildId);
  }
}

function attachDisconnectHandler(connection: VoiceConnection, guildId: string): void {
  connection.on(VoiceConnectionStatus.Disconnected, () => {
    void handleDisconnected(connection, guildId);
  });
}

async function reuseExistingConnection(
  channel: VoiceBasedChannel,
  connection: VoiceConnection
): Promise<VoiceConnection | null> {
  const guildId = channel.guild.id;
  const status = connection.state.status;

  if (status === VoiceConnectionStatus.Ready || status === VoiceConnectionStatus.Connecting) {
    if (connection.joinConfig.channelId !== channel.id) {
      connection.rejoin({
        channelId: channel.id,
        selfDeaf: true,
        selfMute: false,
      });
    }

    if (status === VoiceConnectionStatus.Ready) {
      scheduleIdleDisconnectIfIdle(guildId);
      return connection;
    }

    await entersState(connection, VoiceConnectionStatus.Ready, 10_000);
    scheduleIdleDisconnectIfIdle(guildId);
    return connection;
  }

  if (status !== VoiceConnectionStatus.Destroyed) {
    connection.destroy();
  }

  connections.delete(guildId);
  return null;
}

async function createConnection(channel: VoiceBasedChannel): Promise<VoiceConnection> {
  logger.info(`Connecting to voice channel ${channel.id} in guild ${channel.guild.id}`);
  const guildId = channel.guild.id;
  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId,
    adapterCreator: channel.guild.voiceAdapterCreator,
    selfDeaf: true,
    selfMute: false,
  });

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
    connections.set(guildId, connection);
    clearIdleDisconnect(guildId);
    scheduleIdleDisconnectIfIdle(guildId);
    attachDisconnectHandler(connection, guildId);
    return connection;
  } catch (error) {
    connection.destroy();
    connections.delete(guildId);
    clearIdleDisconnect(guildId);
    throw error;
  }
}

export async function connectToVoiceChannel(channel: VoiceBasedChannel): Promise<VoiceConnection> {
  const guildId = channel.guild.id;
  clearIdleDisconnect(guildId);
  const existing = connections.get(guildId);
  if (existing) {
    const reused = await reuseExistingConnection(channel, existing);
    if (reused) {
      return reused;
    }
  }

  return createConnection(channel);
}

export function disconnectFromVoiceChannel(guildId: string): void {
  clearIdleDisconnect(guildId);
  const connection = connections.get(guildId);

  if (connection) {
    connection.destroy();
    connections.delete(guildId);
    players.delete(guildId);
  }
}

export function getOrCreateAudioPlayer(guildId: string): AudioPlayer {
  let player = players.get(guildId);

  if (!player) {
    player = createAudioPlayer({
      behaviors: {
        noSubscriber: NoSubscriberBehavior.Pause,
      },
    });
    players.set(guildId, player);
  }

  return player;
}

export async function playSoundInChannel(
  channel: VoiceBasedChannel,
  filePath: string
): Promise<void> {
  const connection = await connectToVoiceChannel(channel);
  logger.info({ channelId: channel.id, guildId: channel.guild.id }, 'Connected to voice channel');
  await playAudioFile(connection, channel.guild.id, filePath);
}

export function createAudioResourceFromFile(filePath: string): AudioResource {
  const stream = createReadStream(filePath);
  return createAudioResource(stream);
}

export async function playAudioFile(
  connection: VoiceConnection,
  guildId: string,
  filePath: string
): Promise<void> {
  const player = getOrCreateAudioPlayer(guildId);
  clearIdleDisconnect(guildId);
  const resource = createAudioResourceFromFile(filePath);

  connection.subscribe(player);
  player.play(resource);

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      scheduleIdleDisconnect(guildId);
      reject(new Error('Audio playback timeout'));
    }, 600_000);

    const cleanup = (): void => {
      clearTimeout(timeout);
      player.removeListener('error', onError);
      player.removeListener(AudioPlayerStatus.Idle, onIdle);
    };

    const onError = (error: Error): void => {
      cleanup();
      scheduleIdleDisconnect(guildId);
      reject(error);
    };

    const onIdle = (): void => {
      cleanup();
      scheduleIdleDisconnect(guildId);
      resolve();
    };

    player.on('error', onError);
    player.on(AudioPlayerStatus.Idle, onIdle);
  });
}
