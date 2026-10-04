import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fakeProvider } from './fake-oidc-server.mjs';
import { RedisAuthStore } from '../auth/store.ts';
import { OidcRuntime } from '../auth/oidc.ts';

const dist = path.resolve('web/dist');
const scratch = process.env.TEST_SCRATCH_DIR ?? process.env.TMPDIR ?? '/opt/data/cache/scratch';
await mkdir(scratch, { recursive: true });
const tmp = await mkdtemp(path.join(scratch, 'bg-e2e-'));
const wav = Buffer.alloc(44 + 16000);
wav.write('RIFF');
wav.writeUInt32LE(wav.length - 8, 4);
wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(8000, 24);
wav.writeUInt32LE(16000, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write('data', 36);
wav.writeUInt32LE(16000, 40);
await mkdir(path.join(tmp, 'sounds/metadata'), { recursive: true });
await writeFile(path.join(tmp, 'sounds/fixture.wav'), wav);
await writeFile(
  path.join(tmp, 'sounds/metadata/fixture_meta.json'),
  JSON.stringify({ displayName: 'Fixture Sound', filename: 'fixture.wav', tags: ['fixture'] })
);
process.env.BUTTON_GREMLIN_TAGS_FILE = path.join(tmp, 'sounds/metadata/tags.json');
await writeFile(process.env.BUTTON_GREMLIN_TAGS_FILE, '["fixture"]');
const { buildWebApp } = await import('../app.ts');
process.chdir(tmp);
const provider = await fakeProvider();
const store = await RedisAuthStore.connect(
  process.env.REDIS_TEST_URL,
  'e2e-fixture-secret'.repeat(4)
);
const config = {
  issuer: provider.issuer,
  origin: 'http://127.0.0.1:13000',
  redirectUri: 'http://127.0.0.1:13000/api/auth/callback',
  brokerBase: provider.issuer.slice(0, -1),
  clientId: 'bg',
  clientSecret: 'fixture',
  insecureTest: true,
  automationEnabled: false,
  automationKey: '',
};
const oidc = await OidcRuntime.create(config);
const botCalls = { play: 0, disconnect: 0 };
const app = await buildWebApp({
  client: { isReady: () => true, user: { id: 'fixture' }, guilds: { cache: new Map() } },
  botService: {
    getBotStatus: () => ({ online: true, connected: false }),
    playSound: async () => {
      botCalls.play++;
    },
    disconnectBot: () => {
      botCalls.disconnect++;
    },
  },
  authRuntime: { config, store, oidc },
  logger: false,
  webDistPath: dist,
});
// Fixture control is confined to this nonproduction test launcher, never the app.
const control = (await import('fastify')).default();
control.post('/mode/:mode', async (req) => {
  provider.setMode(req.params.mode);
  return { ok: true };
});
control.post('/revoke', async () => {
  await store.revokeSubject(provider.issuer, 'fixture-user');
  return { ok: true };
});
control.get('/bot-calls', async () => botCalls);
control.get('/preserved', async () => ({
  preserved: (await readFile('sounds/fixture.wav')).equals(wav),
}));
await control.listen({ port: 13001, host: '127.0.0.1' });
await app.listen({ port: 13000, host: '127.0.0.1' });
console.log('E2E fixture ready');
const shutdown = async () => {
  await app.close();
  await control.close();
  await store.close();
  await provider.close();
  await rm(tmp, { recursive: true, force: true });
};
process.once('SIGTERM', () => {
  void shutdown();
});
process.once('SIGINT', () => {
  void shutdown();
});
