import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const storageUrl = new URL('./storage.ts', import.meta.url).href;
const tsxUrl = new URL('../../node_modules/tsx/dist/loader.mjs', import.meta.url).href;
for (const configured of [false, true]) {
  test(
    configured
      ? 'configured PVC tags persist without altering metadata or sound listing'
      : 'legacy cwd tags path remains the default',
    async () => {
      const scratch = process.env.TMPDIR ?? '/opt/data/cache/scratch';
      await mkdir(scratch, { recursive: true });
      const cwd = await mkdtemp(path.join(scratch, 'bg-storage-'));
      try {
        await mkdir(path.join(cwd, 'sounds'), { recursive: true });
        await writeFile(path.join(cwd, 'sounds/fixture.wav'), 'original-audio');
        await writeFile(path.join(cwd, 'tags.json'), '["legacy"]');
        const env = { ...process.env };
        delete env.BUTTON_GREMLIN_TAGS_FILE;
        const tagsFile = configured
          ? path.join(cwd, 'sounds/metadata/tags.json')
          : path.join(cwd, 'tags.json');
        if (configured) env.BUTTON_GREMLIN_TAGS_FILE = tagsFile;
        const run = async (code) => {
          const probe = path.join(cwd, 'probe.mjs');
          await writeFile(probe, `import * as storage from ${JSON.stringify(storageUrl)}; ${code}`);
          const child = spawnSync(process.execPath, ['--import', tsxUrl, probe], {
            cwd,
            env,
            encoding: 'utf8',
            timeout: 30000,
          });
          assert.equal(child.status, 0, child.stderr + child.stdout);
        };
        // The configured parent does not yet exist; writes must create it.
        await run(`await storage.updateTags(['z', 'a', 'a']);`);
        assert.deepEqual(JSON.parse(await readFile(tagsFile, 'utf8')), ['a', 'z']);
        await run(`import assert from 'node:assert/strict';
        assert.deepEqual(await storage.getAllTags(), ['a', 'z']);
        await storage.addTagsToGlobal(['fixture']);
        await storage.writeMetadata('fixture', { filename: 'fixture.wav', displayName: 'Fixture', tags: ['fixture'] });
        const sounds = await storage.listSoundFiles();
        assert.equal(sounds.length, 1);
        assert.equal(sounds[0].name, 'fixture');
        assert.equal(sounds[0].displayName, 'Fixture');
        assert.deepEqual(sounds[0].tags, ['fixture']);
        await storage.removeTagFromAll('fixture');
        assert.deepEqual((await storage.listSoundFiles())[0].tags, []);`);
        assert.deepEqual(JSON.parse(await readFile(tagsFile, 'utf8')), ['a', 'z']);
        assert.equal(
          await readFile(path.join(cwd, 'sounds/fixture.wav'), 'utf8'),
          'original-audio'
        );
        assert.ok((await readdir(path.join(cwd, 'sounds/metadata'))).includes('fixture_meta.json'));
        if (configured)
          assert.equal(await readFile(path.join(cwd, 'tags.json'), 'utf8'), '["legacy"]');
      } finally {
        await rm(cwd, { recursive: true, force: true });
      }
    }
  );
}
