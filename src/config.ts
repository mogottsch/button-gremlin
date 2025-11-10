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

  const logLevel = (process.env['LOG_LEVEL'] ?? 'info').toLowerCase() as
    | 'trace'
    | 'debug'
    | 'info'
    | 'warn'
    | 'error'
    | 'fatal';
  const prettyLog =
    process.env['LOG_PRETTY'] === 'true' ||
    (process.env['LOG_PRETTY'] === undefined && process.env['NODE_ENV'] !== 'production');
  const logDestination = process.env['LOG_DESTINATION'];
  const voiceIdleTimeoutSeconds = process.env['VOICE_IDLE_TIMEOUT_SECONDS'];
  let idleDisconnectTimeoutMs: number | undefined = 10_000;

  if (voiceIdleTimeoutSeconds !== undefined) {
    if (voiceIdleTimeoutSeconds === '') {
      idleDisconnectTimeoutMs = undefined;
    } else {
      if (!/^\d+$/.test(voiceIdleTimeoutSeconds)) {
        throw new Error('VOICE_IDLE_TIMEOUT_SECONDS must be a positive integer');
      }

      const parsed = Number.parseInt(voiceIdleTimeoutSeconds, 10);

      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error('VOICE_IDLE_TIMEOUT_SECONDS must be a positive integer');
      }

      idleDisconnectTimeoutMs = parsed * 1_000;
    }
  }

  return {
    token,
    clientId,
    web: { enabled: webEnabled, port: webPort, apiKey: webApiKey },
    logging: {
      level: logLevel,
      pretty: prettyLog,
      destination: logDestination,
    },
    voice: {
      idleDisconnectTimeoutMs,
    },
  };
}
