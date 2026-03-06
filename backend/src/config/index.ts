import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

function requireEnv(key: string, fallback?: string): string {
  const value = process.env[key];
  if (!value) {
    if (fallback !== undefined) return fallback;
    if (process.env.NODE_ENV === 'test') return '';
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function optionalEnv(key: string, defaultValue: string): string {
  return process.env[key] ?? defaultValue;
}

function intEnv(key: string, defaultValue: number): number {
  const raw = process.env[key];
  if (!raw) return defaultValue;
  const parsed = parseInt(raw, 10);
  if (isNaN(parsed)) throw new Error(`Invalid integer for env var ${key}: ${raw}`);
  return parsed;
}

export const config = {
  server: {
    port: intEnv('PORT', 3000),
    host: optionalEnv('HOST', '0.0.0.0'),
    nodeEnv: optionalEnv('NODE_ENV', 'development'),
    logLevel: optionalEnv('LOG_LEVEL', 'info'),
  },

  mysql: {
    host: optionalEnv('MYSQL_HOST', '127.0.0.1'),
    port: intEnv('MYSQL_PORT', 3306),
    user: optionalEnv('MYSQL_USER', 'clawconsole'),
    password: optionalEnv('MYSQL_PASSWORD', ''),
    database: optionalEnv('MYSQL_DATABASE', 'clawconsole'),
  },

  redis: {
    host: optionalEnv('REDIS_HOST', '127.0.0.1'),
    port: intEnv('REDIS_PORT', 6379),
    password: process.env.REDIS_PASSWORD || undefined,
    db: intEnv('REDIS_DB', 0),
  },

  encryption: {
    credentialKey: requireEnv('CREDENTIAL_ENCRYPTION_KEY'),
  },

  ssh: {
    defaultUser: optionalEnv('SSH_DEFAULT_USER', 'claw'),
    defaultPort: intEnv('SSH_DEFAULT_PORT', 22),
    connectionTimeoutMs: intEnv('SSH_CONNECTION_TIMEOUT_MS', 10_000),
    idleTimeoutMs: intEnv('SSH_IDLE_TIMEOUT_MS', 300_000),
    maxConnectionsPerMachine: intEnv('SSH_MAX_CONNECTIONS_PER_MACHINE', 4),
    queueTimeoutMs: intEnv('SSH_QUEUE_TIMEOUT_MS', 30_000),
    maxQueueSize: intEnv('SSH_MAX_QUEUE_SIZE', 20),
  },

  sync: {
    pullStalenessThresholdMs: intEnv('SYNC_PULL_STALENESS_THRESHOLD_MS', 30_000),
    maxRetries: intEnv('SYNC_MAX_RETRIES', 3),
    manifestCacheTtlS: intEnv('SYNC_MANIFEST_CACHE_TTL_S', 60),
  },

  jobs: {
    healthCheckIntervalS: intEnv('HEALTH_CHECK_INTERVAL_S', 60),
    autoPullIntervalS: intEnv('AUTO_PULL_INTERVAL_S', 300),
    syncRetryIntervalS: intEnv('SYNC_RETRY_INTERVAL_S', 120),
    sessionSyncIntervalS: intEnv('SESSION_SYNC_INTERVAL_S', 60),
    logCollectorIntervalS: intEnv('LOG_COLLECTOR_INTERVAL_S', 300),
  },

  gateway: {
    defaultPort: intEnv('GATEWAY_DEFAULT_PORT', 18789),
  },

  playground: {
    anthropicApiKey: optionalEnv('ANTHROPIC_API_KEY', ''),
    maxSessionDurationS: intEnv('PLAYGROUND_MAX_SESSION_DURATION_S', 300),
    maxToolCalls: intEnv('PLAYGROUND_MAX_TOOL_CALLS', 50),
    sandboxMemoryMb: intEnv('PLAYGROUND_SANDBOX_MEMORY_MB', 256),
    defaultModel: optionalEnv('PLAYGROUND_DEFAULT_MODEL', 'claude-sonnet-4-20250514'),
  },
} as const;

export type AppConfig = typeof config;
