import { REST, Routes } from 'discord.js';
import { getConfig } from './config.js';
import { commands } from './commands/index.js';

async function deployCommands(): Promise<void> {
  try {
    const config = getConfig();
    const rest = new REST().setToken(config.token);

    const commandData = commands.map((command) => command.data.toJSON());

    console.log(`🚀 Started refreshing ${commandData.length} global (/) commands.`);
    console.log('⚠️  Note: Global commands can take up to 1 hour to update.');

    await rest.put(Routes.applicationCommands(config.clientId), { body: commandData });

    console.log(`✅ Successfully reloaded ${commandData.length} global (/) commands.`);
  } catch (error) {
    console.error('❌ Error deploying commands:', error);
    process.exit(1);
  }
}

void deployCommands();
