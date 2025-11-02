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

const connections = new Map<string, VoiceConnection>();
const players = new Map<string, AudioPlayer>();

export function getConnection(guildId: string): VoiceConnection | undefined {
  return connections.get(guildId);
}

export function getAllConnections(): Map<string, VoiceConnection> {
  return connections;
}

export async function connectToVoiceChannel(channel: VoiceBasedChannel): Promise<VoiceConnection> {
  const guildId = channel.guild.id;

  let connection = connections.get(guildId);

  if (connection) {
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
        return connection;
      }

      await entersState(connection, VoiceConnectionStatus.Ready, 10_000);
      return connection;
    }

    if (status !== VoiceConnectionStatus.Destroyed) {
      connection.destroy();
    }
  }

  connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: channel.guild.id,
    adapterCreator: channel.guild.voiceAdapterCreator,
    selfDeaf: true,
    selfMute: false,
  });

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
    connections.set(guildId, connection);

    connection.on(VoiceConnectionStatus.Disconnected, () => {
      void (async (): Promise<void> => {
        try {
          await Promise.race([
            entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
            entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
          ]);
        } catch {
          connection.destroy();
          connections.delete(guildId);
          players.delete(guildId);
        }
      })();
    });

    return connection;
  } catch (error) {
    connection.destroy();
    connections.delete(guildId);
    throw error;
  }
}

export function disconnectFromVoiceChannel(guildId: string): void {
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
  const resource = createAudioResourceFromFile(filePath);

  connection.subscribe(player);
  player.play(resource);

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Audio playback timeout'));
    }, 600_000);

    const cleanup = (): void => {
      clearTimeout(timeout);
      player.removeListener('error', onError);
      player.removeListener(AudioPlayerStatus.Idle, onIdle);
    };

    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };

    const onIdle = (): void => {
      cleanup();
      resolve();
    };

    player.on('error', onError);
    player.on(AudioPlayerStatus.Idle, onIdle);
  });
}
