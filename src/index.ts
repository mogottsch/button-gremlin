import { Client, GatewayIntentBits } from 'discord.js';
import { getConfig } from './config.js';
import { registerReadyEvent } from './events/ready.js';
import { registerInteractionEvent } from './events/interactionCreate.js';
import { createWebServer } from './web/index.js';
import { logger } from './logger.js';
import { migrate } from './migration.js';

async function main(): Promise<void> {
  try {
    // Run migrations first
    logger.info('Running database migrations...');
    migrate();
    logger.info('Migrations completed successfully');

    const config = getConfig();

    const client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
    });

    registerReadyEvent(client);
    registerInteractionEvent(client);

    await client.login(config.token);

    if (config.web.enabled) {
      void createWebServer(client, config.web.apiKey, config.web.port, config);
    }
  } catch (error) {
    logger.error({ err: error }, 'Failed to start bot');
    process.exit(1);
  }
}

void main();
