import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRevokeArgs } from '../auth/revoke-session.ts';
test('operator revoke requires exact issuer and subject, rejects duplicates and missing', () => {
  assert.deepEqual(parseRevokeArgs(['--', '--issuer', 'https://fixture/', '--subject', '001']), {
    issuer: 'https://fixture/',
    subject: '001',
  });
  for (const args of [
    [],
    ['--issuer', 'https://fixture/'],
    ['--issuer', 'https://fixture/', '--subject', ''],
    ['--issuer', ' https://fixture/', '--subject', 's'],
    ['--issuer', 'https://fixture/', '--subject', ' s'],
    ['--issuer', 'https://fixture/', '--issuer', 'https://fixture/', '--subject', 's'],
  ])
    assert.throws(() => parseRevokeArgs(args));
});
