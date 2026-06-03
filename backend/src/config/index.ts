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

function boolEnv(key: string, defaultValue: boolean): boolean {
  const raw = process.env[key];
  if (raw === undefined) return defaultValue;
  return raw === 'true' || raw === '1';
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

  // Single-shared-password auth gate. When ``password`` and ``secret`` are
  // both set, every /api/* request must carry a valid bearer token issued
  // by POST /api/auth/login (whitelist in auth.middleware.ts). Leaving
  // either unset disables the gate (with a warning log on boot) so a
  // half-configured staging box can still serve traffic.
  auth: {
    password: optionalEnv('APP_PASSWORD', ''),
    secret: optionalEnv('APP_AUTH_SECRET', ''),
    tokenTtlS: intEnv('APP_AUTH_TOKEN_TTL_S', 60 * 60 * 24 * 7), // 7 days
  },

  ssh: {
    defaultUser: optionalEnv('SSH_DEFAULT_USER', 'claw'),
    defaultPort: intEnv('SSH_DEFAULT_PORT', 22),
    connectionTimeoutMs: intEnv('SSH_CONNECTION_TIMEOUT_MS', 30_000),
    commandTimeoutMs: intEnv('SSH_COMMAND_TIMEOUT_MS', 60_000),
    idleTimeoutMs: intEnv('SSH_IDLE_TIMEOUT_MS', 300_000),
    maxConnectionsPerMachine: intEnv('SSH_MAX_CONNECTIONS_PER_MACHINE', 4),
    queueTimeoutMs: intEnv('SSH_QUEUE_TIMEOUT_MS', 60_000),
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
    // Per-job enable flags. Set any of these to "false" in .env to disable
    // the corresponding recurring background job. The matching BullMQ worker
    // is also skipped so the queue is never drained automatically.
    healthCheckEnabled: boolEnv('HEALTH_CHECK_ENABLED', true),
    autoPullEnabled: boolEnv('AUTO_PULL_ENABLED', true),
    syncRetryEnabled: boolEnv('SYNC_RETRY_ENABLED', true),
    sessionSyncEnabled: boolEnv('SESSION_SYNC_ENABLED', true),
    logCollectorEnabled: boolEnv('LOG_COLLECTOR_ENABLED', true),
    evoClawEnabled: boolEnv('EVO_CLAW_ENABLED', true),
    summaryEnabled: boolEnv('SUMMARY_ENABLED', true),
    dailyOssBackupEnabled: boolEnv('DAILY_OSS_BACKUP_ENABLED', true),
  },

  gateway: {
    defaultPort: intEnv('GATEWAY_DEFAULT_PORT', 18789),
    // When false, the WebSocket gateway connector pool will not auto-connect
    // to remote machines. Useful when the remote gateway service is not
    // running and you don't want reconnect-loop log spam.
    connectorEnabled: boolEnv('GATEWAY_CONNECTOR_ENABLED', true),
  },

  playground: {
    anthropicApiKey: optionalEnv('ANTHROPIC_API_KEY', ''),
    maxSessionDurationS: intEnv('PLAYGROUND_MAX_SESSION_DURATION_S', 300),
    maxToolCalls: intEnv('PLAYGROUND_MAX_TOOL_CALLS', 50),
    sandboxMemoryMb: intEnv('PLAYGROUND_SANDBOX_MEMORY_MB', 256),
    defaultModel: optionalEnv('PLAYGROUND_DEFAULT_MODEL', 'claude-sonnet-4-20250514'),
    browserHeadless: optionalEnv('PLAYGROUND_BROWSER_HEADLESS', 'true') === 'true',
    browserbaseApiKey: optionalEnv('BROWSERBASE_API_KEY', ''),
    browserbaseProjectId: optionalEnv('BROWSERBASE_PROJECT_ID', ''),
  },
  evoClaw: {
    intervalS: intEnv('EVO_CLAW_INTERVAL_S', 86400),
    minSessions: intEnv('EVO_CLAW_MIN_SESSIONS', 5),
    maxRulesPerFile: intEnv('EVO_CLAW_MAX_RULES_PER_FILE', 15),
    decayThresholdRuns: intEnv('EVO_CLAW_DECAY_THRESHOLD_RUNS', 10),
    judgeModel: optionalEnv('EVO_CLAW_JUDGE_MODEL', 'claude-sonnet-4-20250514'),
  },

  backup: {
    // Per-machine backups land at <root>/<machineName>/<timestamp>/.
    // Default: <repo-root>/backups, derived from this file's location
    // (src/config/index.ts is 4 levels deep from the repo root).
    // Override via BACKUP_ROOT to write elsewhere (absolute path).
    root: process.env.BACKUP_ROOT
      ? path.resolve(process.env.BACKUP_ROOT)
      : path.resolve(__dirname, '../../..', 'backups'),
  },

  // Session summaries: LLM-generated periodic business recaps of each bot's
  // conversation activity. The recurring job runs on a cron schedule (default
  // 00:00 and 12:00 Asia/Shanghai) and summarizes the previous `windowHours`
  // of activity for every bot that had messages. Bots whose operator opts in
  // (agents.summary_push_enabled=true) additionally get pushed to a Feishu
  // group via im/v1/messages using FEISHU_APP_ID/APP_SECRET + chat_id below.
  summaries: {
    geminiApiKey: optionalEnv('GEMINI_API_KEY', ''),
    model: optionalEnv('SUMMARY_MODEL', 'gemini-3-flash-preview'),
    cronPattern: optionalEnv('SUMMARY_CRON', '0 0,12 * * *'),
    timezone: optionalEnv('SUMMARY_TIMEZONE', 'Asia/Shanghai'),
    windowHours: intEnv('SUMMARY_WINDOW_HOURS', 12),
    feishu: {
      appId: optionalEnv('FEISHU_APP_ID', ''),
      appSecret: optionalEnv('FEISHU_APP_SECRET', ''),
      summaryChatId: optionalEnv('FEISHU_SUMMARY_CHAT_ID', ''),
    },
  },

  // Daily backup of all online-machine agents to OSS via DistillPushService.
  // Iterates online machines, pushes each non-draft agent (persona/skills/
  // vector/raw memory) to OSS with content-hash diffing for persona so
  // unchanged files are skipped. Runs once a day on cronPattern in the
  // configured timezone, with `concurrency` agents in-flight per machine.
  // Disable via DAILY_OSS_BACKUP_ENABLED=false (e.g. on staging clones).
  dailyOssBackup: {
    cronPattern: optionalEnv('DAILY_OSS_BACKUP_CRON', '0 3 * * *'),
    timezone: optionalEnv('DAILY_OSS_BACKUP_TIMEZONE', 'Asia/Shanghai'),
    concurrency: intEnv('DAILY_OSS_BACKUP_CONCURRENCY', 2),
    perAgentTimeoutMs: intEnv('DAILY_OSS_BACKUP_PER_AGENT_TIMEOUT_MS', 600_000),
  },
} as const;

export type AppConfig = typeof config;
