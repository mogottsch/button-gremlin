import { Client, Events } from 'discord.js';

export function registerReadyEvent(client: Client): void {
  client.once(Events.ClientReady, (readyClient) => {
    console.log(`✅ Bot ready! Logged in as ${readyClient.user.tag}`);
  });
}

