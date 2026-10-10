import test from 'node:test';
import assert from 'node:assert/strict';
import { getBotStatus, playSound, disconnectBot } from '../services/bot-service.ts';
import { getAllConnections } from '../../services/audio.ts';
const guildId = '111111111111111111';
const channel = {
  id: '222222222222222222',
  name: 'Launch',
  guild: { id: guildId, name: 'Launch guild', voiceStates: { cache: new Map() } },
};
const client = {
  isReady: () => true,
  user: { id: 'bot' },
  guilds: {
    cache: new Map([
      [
        'other',
        {
          members: {
            cache: new Map([['bot', { voice: { channel: { name: 'Secret other channel' } } }]]),
          },
        },
      ],
    ]),
  },
};
test('Activity status does not disclose standalone other-guild connection', () => {
  assert.deepEqual(getBotStatus(client, channel), { online: true, connected: false });
  channel.guild.voiceStates.cache.set('bot', { channelId: channel.id });
  assert.deepEqual(getBotStatus(client, channel), {
    online: true,
    connected: true,
    channelName: 'Launch',
    guildName: 'Launch guild',
  });
  channel.guild.voiceStates.cache.clear();
});
test('Activity playback and disconnect refuse another launch channel without moving or destroying it', async () => {
  let destroyed = false;
  const connection = {
    joinConfig: { channelId: '999999999999999999' },
    destroy: () => (destroyed = true),
  };
  const connections = getAllConnections();
  connections.set(guildId, connection);
  try {
    await assert.rejects(playSound(client, 'never-played', channel), /another channel/);
    assert.throws(() => disconnectBot(client, channel), /launch channel/);
    assert.equal(connections.get(guildId), connection);
    assert.equal(destroyed, false);
  } finally {
    connections.delete(guildId);
  }
});
test('Activity disconnect retires only its own guild connection', () => {
  let destroyed = false;
  const own = {
    joinConfig: { channelId: channel.id },
    state: { status: 'ready' },
    destroy: () => (destroyed = true),
  };
  const other = { joinConfig: { channelId: 'other' } };
  const connections = getAllConnections();
  connections.set(guildId, own);
  connections.set('other', other);
  try {
    disconnectBot(client, channel);
    assert.equal(destroyed, true);
    assert.equal(connections.get(guildId), undefined);
    assert.equal(connections.get('other'), other);
  } finally {
    connections.delete(guildId);
    connections.delete('other');
  }
});
