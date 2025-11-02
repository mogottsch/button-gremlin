import { REST, Routes } from 'discord.js';
import { getConfig } from './config.js';
import { commands } from './commands/index.js';
import { logger } from './logger.js';

async function deployCommands(): Promise<void> {
  try {
    const config = getConfig();
    const rest = new REST().setToken(config.token);

    const commandData = commands.map((command) => command.data.toJSON());

    logger.info({ commandCount: commandData.length }, 'Started refreshing global commands');
    logger.warn('Global commands can take up to 1 hour to update');

    await rest.put(Routes.applicationCommands(config.clientId), { body: commandData });

    logger.info({ commandCount: commandData.length }, 'Successfully reloaded global commands');
  } catch (error) {
    logger.error({ err: error }, 'Error deploying commands');
    process.exit(1);
  }
}

void deployCommands();
