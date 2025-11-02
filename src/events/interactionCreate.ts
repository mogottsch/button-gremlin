import { Client, Events, Interaction } from 'discord.js';
import { commands } from '../commands/index.js';
import { logger } from '../logger.js';

export function registerInteractionEvent(client: Client): void {
  client.on(Events.InteractionCreate, (interaction: Interaction) => {
    void (async (): Promise<void> => {
      if (interaction.isChatInputCommand()) {
        const command = commands.find((cmd) => cmd.data.name === interaction.commandName);

        if (!command) {
          logger.warn(
            { commandName: interaction.commandName },
            'No command matching interaction found'
          );
          return;
        }

        try {
          await command.execute(interaction);
        } catch (error) {
          logger.error(
            { err: error, commandName: interaction.commandName },
            'Error executing command'
          );

          const errorMessage = '❌ There was an error while executing this command!';

          if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: errorMessage, ephemeral: true });
          } else {
            await interaction.reply({ content: errorMessage, ephemeral: true });
          }
        }
      } else if (interaction.isAutocomplete()) {
        const command = commands.find((cmd) => cmd.data.name === interaction.commandName);

        if (!command?.autocomplete) {
          return;
        }

        try {
          await command.autocomplete(interaction);
        } catch (error) {
          logger.error(
            { err: error, commandName: interaction.commandName },
            'Error in autocomplete'
          );
        }
      }
    })();
  });
}
