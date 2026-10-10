import test from 'node:test';
import assert from 'node:assert/strict';
import * as config from '../auth/config.ts';
test('Activity is optional and enabled configuration pins app and proxy, requiring private secret', () => {
  assert.equal(typeof config.readActivityConfig, 'function');
  assert.equal(config.readActivityConfig({}), undefined);
  assert.throws(
    () => config.readActivityConfig({ DISCORD_ACTIVITY_ENABLED: 'true' }),
    /DISCORD_CLIENT_SECRET/
  );
  assert.deepEqual(
    config.readActivityConfig({
      DISCORD_ACTIVITY_ENABLED: 'true',
      DISCORD_CLIENT_SECRET: 'fixture-secret',
    }),
    {
      clientId: '1434488648228929629',
      origin: 'https://1434488648228929629.discordsays.com',
      clientSecret: 'fixture-secret',
    }
  );
  assert.throws(() => config.readActivityConfig({ DISCORD_ACTIVITY_ENABLED: 'yes' }), /boolean/);
});
