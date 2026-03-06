import knex, { type Knex } from 'knex';
import { config } from '../config/index.js';
import { createChildLogger } from './logger.js';

const log = createChildLogger('db');

let instance: Knex | null = null;

export function getDb(): Knex {
  if (!instance) {
    instance = knex({
      client: 'mysql2',
      connection: {
        host: config.mysql.host,
        port: config.mysql.port,
        user: config.mysql.user,
        password: config.mysql.password,
        database: config.mysql.database,
        charset: 'utf8mb4',
        timezone: '+00:00',
      },
      pool: {
        min: 2,
        max: 10,
        acquireTimeoutMillis: 30_000,
      },
      migrations: {
        directory: '../database/migrations',
        extension: 'ts',
      },
    });
    log.info('MySQL connection pool created');
  }
  return instance;
}

export async function closeDb(): Promise<void> {
  if (instance) {
    await instance.destroy();
    instance = null;
    log.info('MySQL connection pool closed');
  }
}

export type { Knex };
