import assert from 'node:assert/strict';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  brotliCompressSync,
  brotliDecompress,
  brotliDecompressSync,
  createBrotliDecompress,
} from 'node:zlib';

// Benign decoder compatibility checks, not an exploit or proof of CVE reachability.
const plain = Buffer.from(
  'Button Gremlin: SSO, Discord Activity and audio preserved.\n'.repeat(128)
);
const compressed = brotliCompressSync(plain);

test('runtime is on the reviewed fixed Node 22 release line', () => {
  const [major, minor, patch] = process.versions.node.split('.').map(Number);
  assert.ok(
    major === 22 && (minor > 23 || (minor === 23 && patch >= 4)),
    `Node ${process.versions.node} is outside the reviewed >=22.23.4 <23 runtime range`
  );
});

test('benign Brotli sync and async decoding preserve bytes', async () => {
  assert.deepEqual(brotliDecompressSync(compressed), plain);
  assert.deepEqual(await promisify(brotliDecompress)(compressed), plain);
});

test('benign chunked Brotli stream preserves bytes', async () => {
  const chunks = [];
  await pipeline(
    Readable.from(Array.from(compressed, (byte) => Buffer.from([byte]))),
    createBrotliDecompress(),
    async (source) => {
      for await (const chunk of source) chunks.push(chunk);
    }
  );
  assert.deepEqual(Buffer.concat(chunks), plain);
});

test('truncated benign Brotli input rejects in sync and async decoders', async () => {
  const truncated = compressed.subarray(0, Math.floor(compressed.length / 2));
  assert.throws(() => brotliDecompressSync(truncated));
  await assert.rejects(promisify(brotliDecompress)(truncated));
});
