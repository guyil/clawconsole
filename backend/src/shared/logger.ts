import pino from 'pino';
import { config } from '../config/index.js';

export const logger = pino({
  level: config.server.logLevel,
  transport:
    config.server.nodeEnv === 'development'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } }
      : undefined,
});

export function createChildLogger(module: string) {
  return logger.child({ module });
}
