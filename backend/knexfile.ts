import type { Knex } from 'knex';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '.env') });

const config: Knex.Config = {
  client: 'mysql2',
  connection: {
    host: process.env.MYSQL_HOST ?? '127.0.0.1',
    port: parseInt(process.env.MYSQL_PORT ?? '3306', 10),
    user: process.env.MYSQL_USER ?? 'clawconsole',
    password: process.env.MYSQL_PASSWORD ?? '',
    database: process.env.MYSQL_DATABASE ?? 'clawconsole',
    charset: 'utf8mb4',
  },
  migrations: {
    directory: path.resolve(__dirname, 'src/database/migrations'),
    extension: 'ts',
  },
  pool: {
    min: 2,
    max: 10,
  },
};

export default config;
