import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { getConfig } from '../../config.ts';
test('bot-only does not need web auth; web cannot silently use API key; strict port and booleans', () => {
  const saved = { ...process.env };
  try {
    process.env.DISCORD_TOKEN = 'fixture';
    process.env.DISCORD_CLIENT_ID = 'fixture';
    process.env.WEB_ENABLED = 'false';
    assert.equal(getConfig().web.enabled, false);
    process.env.WEB_ENABLED = 'true';
    process.env.WEB_API_KEY = 'fixture';
    assert.throws(() => getConfig());
    process.env.WEB_ENABLED = 'invalid';
    assert.throws(() => getConfig());
    process.env.WEB_ENABLED = 'false';
    process.env.WEB_PORT = '123invalid';
    assert.throws(() => getConfig());
  } finally {
    process.env = saved;
  }
});
test('actual startup rejects invalid SSO before sound migration or Discord connection', async () => {
  const scratch = process.env.TEST_SCRATCH_DIR ?? process.env.TMPDIR ?? '/opt/data/cache/scratch';
  await mkdir(scratch, { recursive: true });
  const tmp = await mkdtemp(path.join(scratch, 'bg-startup-'));
  try {
    await mkdir(path.join(tmp, 'sounds/metadata'), { recursive: true });
    const before = 'sentinel metadata';
    await writeFile(path.join(tmp, 'sounds/metadata/fixture_meta.json'), before);
    await writeFile(path.join(tmp, 'sounds/fixture.mp3'), 'not-real-audio');
    const env = {
      ...process.env,
      DISCORD_TOKEN: 'never-use-fixture',
      DISCORD_CLIENT_ID: 'fixture',
      WEB_ENABLED: 'true',
      OIDC_ISSUER: '',
      LOG_PRETTY: 'false',
      NODE_ENV: 'production',
    };
    const result = spawnSync(
      process.execPath,
      [...process.execArgv, fileURLToPath(new URL('../../index.ts', import.meta.url))],
      { cwd: tmp, env, encoding: 'utf8', timeout: 10000 }
    );
    assert.equal(result.status, 1);
    assert.match(result.stdout, /Startup failed/);
    assert.ok(!result.stdout.includes('Migrations completed'));
    assert.ok(!result.stdout.includes('never-use-fixture'));
    assert.equal(
      await readFile(path.join(tmp, 'sounds/metadata/fixture_meta.json'), 'utf8'),
      before
    );
    assert.equal(await readFile(path.join(tmp, 'sounds/fixture.mp3'), 'utf8'), 'not-real-audio');
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
