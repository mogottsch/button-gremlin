import { Client, GatewayIntentBits } from 'discord.js';
import { getConfig } from './config.js';
import { registerReadyEvent } from './events/ready.js';
import { registerInteractionEvent } from './events/interactionCreate.js';

async function main(): Promise<void> {
  try {
    const config = getConfig();

    const client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
      ],
    });

    registerReadyEvent(client);
    registerInteractionEvent(client);

    await client.login(config.token);
  } catch (error) {
    console.error('❌ Failed to start bot:', error);
    process.exit(1);
  }
}

void main();

