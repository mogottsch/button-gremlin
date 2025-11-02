import { Client, Events } from 'discord.js';
import { logger } from '../logger.js';

export function registerReadyEvent(client: Client): void {
  client.once(Events.ClientReady, (readyClient) => {
    logger.info({ userTag: readyClient.user.tag }, 'Bot ready');

    const inviteUrl = `https://discord.com/api/oauth2/authorize?client_id=${readyClient.user.id}&permissions=36703232&scope=bot%20applications.commands`;
    logger.info({ inviteUrl }, 'Invite URL generated');
  });
}
