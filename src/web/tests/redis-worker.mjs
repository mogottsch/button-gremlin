import { RedisAuthStore } from '../auth/store.ts';
process.once('message', async (message) => {
  const store = await RedisAuthStore.connect(message.url, message.secret);
  try {
    let result;
    if (message.action === 'take')
      result = await store.takeTransaction(message.state, message.binding);
    if (message.action === 'get') result = await store.getSession(message.token);
    if (message.action === 'revoke') {
      await store.revokeSubject(message.issuer, message.subject);
      result = true;
    }
    if (message.action === 'delete') {
      await store.deleteSession(message.token);
      result = true;
    }
    process.send({ result });
  } catch {
    process.send({ error: 'Worker failure' });
  } finally {
    await store.close();
    process.disconnect();
  }
});
