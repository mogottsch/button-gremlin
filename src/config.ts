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

  return { token, clientId };
}
