import { RedisAuthStore, type AuthStore } from './store.js';
import { OidcRuntime } from './oidc.js';
import type { AuthConfig } from './config.js';
export interface AuthRuntime {
  config: AuthConfig;
  store: AuthStore;
  oidc: OidcRuntime;
}
export async function createAuthRuntime(config: AuthConfig): Promise<AuthRuntime> {
  const store = await RedisAuthStore.connect(config.redisUrl, config.sessionSecret);
  try {
    return { config, store, oidc: await OidcRuntime.create(config) };
  } catch {
    await store.close();
    throw new Error('Authentication dependency unavailable');
  }
}
