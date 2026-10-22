import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { stat } from 'node:fs/promises';

// Run against the Docker artifact, not a host-rebuilt dist or host native module.
const require = createRequire('/app/package.json');

test('image retains native Opus encode/decode, DAVE, voice and FFmpeg', async () => {
  const { OpusEncoder } = require('@discordjs/opus');
  const encoder = new OpusEncoder(48000, 2);
  const pcm = Buffer.alloc(960 * 2 * 2);
  for (let i = 0; i < 960; i++) {
    const sample = Math.round(12000 * Math.sin((2 * Math.PI * 440 * i) / 48000));
    pcm.writeInt16LE(sample, i * 4);
    pcm.writeInt16LE(sample, i * 4 + 2);
  }
  const packet = encoder.encode(pcm);
  assert.ok(packet.length > 0);
  const decoded = encoder.decode(packet);
  assert.equal(decoded.length, pcm.length);
  assert.ok(decoded.some((byte) => byte !== 0));
  require('@snazzah/davey');
  require('@discordjs/voice');
  assert.equal(spawnSync('ffmpeg', ['-version']).status, 0);
  assert.ok((await stat('/app/dist/web/auth/oidc.js')).isFile());
  assert.ok((await stat('/app/dist/web/auth/routes.js')).isFile());
  assert.ok((await stat('/app/dist/web/activity/routes.js')).isFile());
  assert.ok((await stat('/app/web/dist/index.html')).isFile());
});
