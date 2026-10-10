import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { getVoiceConnection, VoiceConnectionStatus } from '@discordjs/voice';
import { playSound } from '../web/services/bot-service.ts';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  connectToVoiceChannel,
  disconnectFromVoiceChannel,
  getConnection,
  getOrCreateAudioPlayer,
} from './audio.ts';

// Only the Discord gateway adapter is fake: joinVoiceChannel, its guild registry,
// connection reuse and Ready waiting all use the installed @discordjs/voice.
function fixture(guildId) {
  const payloads = [];
  const guild = {
    id: guildId,
    voiceAdapterCreator: () => ({
      sendPayload: (payload) => {
        payloads.push(payload);
        return true;
      },
      destroy() {},
    }),
  };
  return { payloads, a: { id: 'channel-a', guild }, b: { id: 'channel-b', guild } };
}

function joins(payloads) {
  return payloads
    .filter((payload) => payload.d.channel_id !== null)
    .map((payload) => payload.d.channel_id);
}

function settle(promise) {
  return promise.then(
    () => undefined,
    (error) => error
  );
}

test('same-channel concurrent joins share connection establishment without duplicate gateway joins', async () => {
  const { a, payloads } = fixture('same-channel-initial');
  const first = settle(connectToVoiceChannel(a));
  const second = settle(connectToVoiceChannel(a));
  try {
    await setImmediate();
    assert.deepEqual(joins(payloads), [a.id]);
  } finally {
    const connection = getVoiceConnection(a.guild.id);
    connection?.emit('error', new Error('fixture connection failure'));
    await Promise.all([first, second]);
    disconnectFromVoiceChannel(a.guild.id);
    if (connection && connection.state.status !== VoiceConnectionStatus.Destroyed)
      connection.destroy();
  }
});

test('standalone join cannot move a guild reserved by pending Activity playback', async () => {
  const { a, b, payloads } = fixture('activity-versus-standalone');
  const first = settle(playSound({}, 'never-played', a));
  const second = settle(connectToVoiceChannel(b));
  try {
    await setImmediate();
    assert.equal(getVoiceConnection(a.guild.id).listenerCount(VoiceConnectionStatus.Ready), 1);
    // Fail the pending establishment to drain both requests without a gateway.
    getVoiceConnection(a.guild.id).emit('error', new Error('fixture connection failure'));
    assert.match((await second).message, /another channel/);
    assert.deepEqual(joins(payloads), [a.id]);
  } finally {
    await first;
    disconnectFromVoiceChannel(a.guild.id);
    await second;
  }
});

test('disconnect during initial Activity join cancels it and allows a new channel reservation', async () => {
  const { a, b, payloads } = fixture('disconnect-initial');
  const first = settle(playSound({}, 'never-played', a));
  const old = getVoiceConnection(a.guild.id);
  try {
    disconnectFromVoiceChannel(a.guild.id);
    assert.equal(getVoiceConnection(a.guild.id), undefined);
    const result = await Promise.race([first, setImmediate().then(() => 'still pending')]);
    assert.notEqual(result, 'still pending');
    const second = settle(playSound({}, 'never-played', b));
    getVoiceConnection(a.guild.id).emit('error', new Error('fixture connection failure'));
    await second;
    assert.deepEqual(joins(payloads), [a.id, b.id]);
    assert.equal(getConnection(a.guild.id), undefined);
  } finally {
    if (old.listenerCount('error')) old.emit('error', new Error('fixture connection failure'));
    await first;
    disconnectFromVoiceChannel(a.guild.id);
    if (old.state.status !== VoiceConnectionStatus.Destroyed) old.destroy();
  }
});

test('same-channel Activity playback keeps its reservation until both requests settle, including disconnect', async () => {
  process.env.DISCORD_TOKEN = 'offline-test-fixture';
  process.env.DISCORD_CLIENT_ID = 'offline-test-fixture';
  process.env.VOICE_IDLE_TIMEOUT_SECONDS = '';
  process.env.WEB_ENABLED = 'false';
  const dir = await mkdtemp(join(tmpdir(), 'voice-isolation-'));
  const file = join(dir, 'sound.wav');
  // Valid silent PCM WAV input; no audio is sent to Discord.
  const wav = Buffer.alloc(44 + 96000);
  wav.write('RIFF');
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(2, 22);
  wav.writeUInt32LE(48000, 24);
  wav.writeUInt32LE(192000, 28);
  wav.writeUInt16LE(4, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(wav.length - 44, 40);
  await writeFile(file, wav);
  const { a, b, payloads } = fixture('activity-playback-reservation');
  const first = settle(playSound({}, file, a));
  const second = settle(playSound({}, file, a));
  const connection = getVoiceConnection(a.guild.id);
  const player = getOrCreateAudioPlayer(a.guild.id);
  try {
    // Resolve real entersState without starting any voice networking.
    connection.emit(VoiceConnectionStatus.Ready);
    for (let i = 0; i < 100 && player.listenerCount('idle') < 2; i++) await setImmediate();
    assert.equal(player.listenerCount('idle'), 2);
    assert.deepEqual(joins(payloads), [a.id]);
    await assert.rejects(connectToVoiceChannel(b), /another channel/);
    // Completing one overlapping request must not release the other's claim.
    player.listeners('idle')[0]();
    await first;
    disconnectFromVoiceChannel(a.guild.id);
    await assert.rejects(playSound({}, file, b), /another channel/);
    player.emit('error', new Error('fixture playback failure'));
    assert.match((await second).message, /playback failure/);
    const next = settle(playSound({}, 'never-played', b));
    getVoiceConnection(a.guild.id).emit('error', new Error('fixture connection failure'));
    await next;
    assert.deepEqual(joins(payloads), [a.id, b.id]);
  } finally {
    if (connection.listenerCount('error'))
      connection.emit('error', new Error('fixture connection failure'));
    if (player.listenerCount('error')) player.emit('error', new Error('fixture playback failure'));
    await Promise.all([first, second]);
    player.stop(true);
    disconnectFromVoiceChannel(a.guild.id);
    await rm(dir, { recursive: true, force: true });
  }
});

test('standalone concurrent different-channel joins wait for establishment then retain channel-switch behavior', async () => {
  process.env.DISCORD_TOKEN = 'offline-test-fixture';
  process.env.DISCORD_CLIENT_ID = 'offline-test-fixture';
  process.env.VOICE_IDLE_TIMEOUT_SECONDS = '';
  process.env.WEB_ENABLED = 'false';
  const { a, b, payloads } = fixture('standalone-concurrent');
  const first = connectToVoiceChannel(a);
  const second = connectToVoiceChannel(b);
  const old = getVoiceConnection(a.guild.id);
  try {
    assert.deepEqual(joins(payloads), [a.id]);
    old.state = { ...old.state, status: VoiceConnectionStatus.Ready };
    await first;
    await second;
    assert.deepEqual(joins(payloads), [a.id, b.id]);
    assert.equal(getConnection(a.guild.id).joinConfig.channelId, b.id);
  } finally {
    disconnectFromVoiceChannel(a.guild.id);
  }
});

test('failed Activity establishment releases its reservation for another channel', async () => {
  const { a, b, payloads } = fixture('failure-reservation');
  const first = settle(playSound({}, 'never-played', a));
  getVoiceConnection(a.guild.id).emit('error', new Error('fixture connection failure'));
  await first;
  assert.equal(getConnection(a.guild.id), undefined);
  const second = settle(playSound({}, 'never-played', b));
  getVoiceConnection(a.guild.id).emit('error', new Error('fixture connection failure'));
  await second;
  assert.deepEqual(joins(payloads), [a.id, b.id]);
  assert.equal(getConnection(a.guild.id), undefined);
});

test('concurrent initial Activity playback refuses another channel before Ready without sending a move', async () => {
  const { a, b, payloads } = fixture('activity-concurrent-initial');
  const first = settle(playSound({}, 'never-played', a));
  const second = settle(playSound({}, 'never-played', b));
  try {
    await setImmediate();
    assert.deepEqual(joins(payloads), [a.id]);
    assert.match((await second).message, /another channel/);
    assert.equal(getVoiceConnection(a.guild.id).joinConfig.channelId, a.id);
  } finally {
    const connection = getVoiceConnection(a.guild.id);
    connection?.emit('error', new Error('fixture connection failure'));
    await Promise.all([first, second]);
    disconnectFromVoiceChannel(a.guild.id);
    if (connection && connection.state.status !== VoiceConnectionStatus.Destroyed)
      connection.destroy();
  }
});
