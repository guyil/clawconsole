import Redis from 'ioredis';
import { config } from '../config/index.js';
import { createChildLogger } from './logger.js';

const log = createChildLogger('redis');

let client: Redis | null = null;
let subscriber: Redis | null = null;

export function getRedis(): Redis {
  if (!client) {
    client = new Redis({
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password,
      db: config.redis.db,
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });

    client.on('connect', () => log.info('Redis connected'));
    client.on('error', (err) => log.error({ err }, 'Redis error'));
  }
  return client;
}

export function getRedisSubscriber(): Redis {
  if (!subscriber) {
    subscriber = new Redis({
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password,
      db: config.redis.db,
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });

    subscriber.on('connect', () => log.info('Redis subscriber connected'));
    subscriber.on('error', (err) => log.error({ err }, 'Redis subscriber error'));
  }
  return subscriber;
}

export async function closeRedis(): Promise<void> {
  if (client) {
    await client.quit();
    client = null;
  }
  if (subscriber) {
    await subscriber.quit();
    subscriber = null;
  }
  log.info('Redis connections closed');
}
