import { pathToFileURL } from 'node:url';
import { RedisAuthStore } from './store.js';
import { checkedUrl } from './config.js';
export function parseRevokeArgs(input: string[]): { issuer: string; subject: string } {
  const args = input[0] === '--' ? input.slice(1) : input;
  if (args.length !== 4 || args[0] !== '--issuer' || args[2] !== '--subject')
    throw new Error('Use --issuer <exact issuer> --subject <exact subject>');
  const issuer = args[1];
  const subject = args[3];
  if (!issuer || !subject || issuer.trim() !== issuer || subject.trim() !== subject)
    throw new Error('Exact nonempty identity required');
  checkedUrl(issuer);
  return { issuer, subject };
}
async function main(): Promise<void> {
  let store: RedisAuthStore | undefined;
  try {
    const { issuer, subject } = parseRevokeArgs(process.argv.slice(2));
    const url = process.env['REDIS_URL'];
    const secret = process.env['BUTTON_GREMLIN_SESSION_SECRET'];
    if (!url || !secret || Buffer.byteLength(secret) < 32)
      throw new Error('Missing operator configuration');
    store = await RedisAuthStore.connect(url, secret);
    await store.revokeSubject(issuer, subject);
    console.log('Subject sessions revoked. Remove the Authentik app group to deny fresh login.');
  } catch {
    console.error('Revocation failed. Check exact identity and private Redis configuration.');
    process.exitCode = 1;
  } finally {
    await store?.close();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
