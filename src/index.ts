import { Client, GatewayIntentBits } from 'discord.js';
import { getConfig } from './config.js';
import { registerReadyEvent } from './events/ready.js';
import { registerInteractionEvent } from './events/interactionCreate.js';
import { createWebServer } from './web/index.js';
import { createAuthRuntime, type AuthRuntime } from './web/auth/runtime.js';
import { logger } from './logger.js';
import { migrate } from './migration.js';
async function main(): Promise<void> {
  let authRuntime: AuthRuntime | undefined;
  let client: Client | undefined;
  let app: Awaited<ReturnType<typeof createWebServer>> | undefined;
  try {
    const config = getConfig();
    if (config.web.enabled) {
      if (!config.web.auth) throw new Error('Web authentication configuration required');
      authRuntime = await createAuthRuntime(config.web.auth);
    }
    // Validate SSO dependencies before touching sounds or connecting Discord.
    migrate();
    client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
    });
    registerReadyEvent(client);
    registerInteractionEvent(client);
    await client.login(config.token);
    if (authRuntime) app = await createWebServer(client, config.web.port, config, authRuntime);
    let closing = false;
    const shutdown = async (): Promise<void> => {
      if (closing) return;
      closing = true;
      await app?.close();
      await authRuntime?.store.close();
      await client?.destroy();
    };
    process.once('SIGTERM', () => {
      void shutdown();
    });
    process.once('SIGINT', () => {
      void shutdown();
    });
  } catch {
    await app?.close();
    await authRuntime?.store.close();
    await client?.destroy();
    logger.error('Startup failed; check configuration and authentication dependencies');
    process.exitCode = 1;
  }
}
void main();
