import { config as dotenvConfig } from 'dotenv';
import type { Config } from './types/index.js';

dotenvConfig();

export function getConfig(): Config {
  const token = process.env['DISCORD_TOKEN'];
  const clientId = process.env['DISCORD_CLIENT_ID'];

  if (!token) {
    throw new Error('DISCORD_TOKEN is required in environment variables');
  }

  if (!clientId) {
    throw new Error('DISCORD_CLIENT_ID is required in environment variables');
  }

  const webEnabled = process.env['WEB_ENABLED'] === 'true';
  const webPort = parseInt(process.env['WEB_PORT'] ?? '3000', 10);
  const webApiKey = process.env['WEB_API_KEY'] ?? '';

  if (webEnabled && !webApiKey) {
    throw new Error('WEB_API_KEY is required when WEB_ENABLED=true');
  }

  return {
    token,
    clientId,
    web: { enabled: webEnabled, port: webPort, apiKey: webApiKey },
  };
}
