import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { VoiceConnectionStatus } from '@discordjs/voice';
import { disconnectFromVoiceChannel, getAllConnections, handleDisconnected } from './audio.ts';

// A delayed reconnect timeout can run after the idle timer has already destroyed
// the connection; another caller must not destroy the same object a second time.
test('disconnect ignores an already destroyed connection and removes its stale entry', () => {
  const guildId = 'destroyed-voice-test';
  const connection = new EventEmitter();
  let destroyCalls = 0;
  Object.defineProperty(connection, 'state', {
    value: { status: VoiceConnectionStatus.Destroyed },
  });
  connection.destroy = () => {
    destroyCalls++;
    throw new Error('Cannot destroy VoiceConnection - it has already been destroyed');
  };
  getAllConnections().set(guildId, connection);

  try {
    assert.doesNotThrow(() => disconnectFromVoiceChannel(guildId));
    assert.equal(destroyCalls, 0);
    assert.equal(getAllConnections().has(guildId), false);
  } finally {
    getAllConnections().delete(guildId);
  }
});

test('late disconnect recovery does not destroy a connection that was retired meanwhile', async () => {
  const guildId = 'late-disconnect-test';
  const connection = new EventEmitter();
  let destroyCalls = 0;
  let status = VoiceConnectionStatus.Disconnected;
  Object.defineProperty(connection, 'state', { get: () => ({ status }) });
  connection.destroy = () => {
    destroyCalls++;
    status = VoiceConnectionStatus.Destroyed;
  };
  getAllConnections().set(guildId, connection);

  try {
    const pending = handleDisconnected(connection, guildId);
    disconnectFromVoiceChannel(guildId);
    connection.emit('error', new Error('connection closed'));
    await pending;
    assert.equal(destroyCalls, 1);
    assert.equal(getAllConnections().has(guildId), false);
  } finally {
    getAllConnections().delete(guildId);
  }
});

test('late disconnect recovery leaves a replacement and its adapter untouched', async () => {
  const guildId = 'replacement-voice-test';
  const oldConnection = new EventEmitter();
  const replacement = new EventEmitter();
  Object.defineProperty(oldConnection, 'state', {
    value: { status: VoiceConnectionStatus.Disconnected },
  });
  let destroyCalls = 0;
  let adapterAvailable;
  oldConnection.destroy = (available) => {
    destroyCalls++;
    adapterAvailable = available;
  };
  getAllConnections().set(guildId, oldConnection);

  try {
    const pending = handleDisconnected(oldConnection, guildId);
    getAllConnections().set(guildId, replacement);
    oldConnection.emit('error', new Error('old connection closed'));
    await pending;
    assert.equal(destroyCalls, 0);
    assert.equal(adapterAvailable, undefined);
    assert.equal(getAllConnections().get(guildId), replacement);
  } finally {
    getAllConnections().delete(guildId);
  }
});
