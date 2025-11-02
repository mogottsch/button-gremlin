import pino from 'pino';
import type { Config } from './types/index.js';

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

interface LoggerConfig {
  level: LogLevel;
  pretty: boolean;
  destination?: string;
}

function createLogger(config: LoggerConfig): pino.Logger {
  const options: pino.LoggerOptions = {
    level: config.level,
  };

  if (config.pretty) {
    return pino(
      options,
      pino.transport({
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss Z',
          ignore: 'pid,hostname',
        },
      })
    );
  }

  if (config.destination) {
    return pino(options, pino.destination(config.destination));
  }

  return pino(options);
}

export function createLoggerFromConfig(config: Config): pino.Logger {
  return createLogger({
    level: config.logging.level,
    pretty: config.logging.pretty,
    destination: config.logging.destination,
  });
}

export function createFastifyLogger(config: Config): pino.LoggerOptions | pino.Logger {
  const loggerConfig: pino.LoggerOptions = {
    level: config.logging.level,
  };

  if (config.logging.pretty) {
    loggerConfig.transport = {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss Z',
        ignore: 'pid,hostname',
      },
    };
    return loggerConfig;
  }

  if (config.logging.destination) {
    return pino(loggerConfig, pino.destination(config.logging.destination));
  }

  return loggerConfig;
}

const logLevel = (process.env['LOG_LEVEL'] ?? 'info').toLowerCase() as LogLevel;
const prettyLog =
  process.env['LOG_PRETTY'] === 'true' ||
  (process.env['LOG_PRETTY'] === undefined && process.env['NODE_ENV'] !== 'production');
const logDestination = process.env['LOG_DESTINATION'];

const logger = createLogger({
  level: logLevel,
  pretty: prettyLog,
  destination: logDestination,
});

export { logger };
export default logger;
