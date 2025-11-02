import { Client, Events } from 'discord.js';

export function registerReadyEvent(client: Client): void {
  client.once(Events.ClientReady, (readyClient) => {
    console.log(`✅ Bot ready! Logged in as ${readyClient.user.tag}`);

    const inviteUrl = `https://discord.com/api/oauth2/authorize?client_id=${readyClient.user.id}&permissions=36703232&scope=bot%20applications.commands`;
    console.log(`🔗 Invite URL: ${inviteUrl}`);
  });
}
