import { Queue, Worker, type Job } from 'bullmq';
import { config } from '../config/index.js';
import { createChildLogger } from '../shared/logger.js';

const log = createChildLogger('jobs');

const connection = {
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password,
  db: config.redis.db,
};

export const healthCheckQueue = new Queue('health-check', { connection });
export const autoPullQueue = new Queue('auto-pull', { connection });
export const syncRetryQueue = new Queue('sync-retry', { connection });
export const sessionSyncQueue = new Queue('session-sync', { connection });
export const logCollectorQueue = new Queue('log-collector', { connection });
export const evoClawQueue = new Queue('evo-claw', { connection });
export const summaryQueue = new Queue('summary', { connection });
export const dailyOssBackupQueue = new Queue('daily-oss-backup', { connection });

// Manual / on-demand OSS distill pushes. Carries one job per agent so the
// worker can fan-out at its own pace; routes enqueue here instead of running
// pushAgent inline (each push can take 5+ min on cold mac-minis, which would
// otherwise hit nginx's 300s ``proxy_read_timeout`` and surface as a 504).
// The frontend polls ``/api/distill/push-to-oss/status`` to observe progress.
export const manualOssDistillQueue = new Queue('manual-oss-distill', { connection });

export function createWorker<T>(
  queueName: string,
  handler: (job: Job<T>) => Promise<void>,
  options?: { concurrency?: number },
): Worker<T> {
  const worker = new Worker<T>(queueName, handler, {
    connection,
    concurrency: options?.concurrency ?? 3,
  });

  worker.on('completed', (job) => {
    log.debug({ jobId: job.id, queue: queueName }, 'Job completed');
  });

  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, queue: queueName, err }, 'Job failed');
  });

  return worker;
}

/**
 * Remove any previously scheduled repeat schedulers from a queue so that a
 * job disabled at boot doesn't keep firing from a stale Redis schedule
 * created by a prior run. BullMQ persists repeat schedules in Redis across
 * restarts, so we must explicitly delete them when toggling jobs off.
 */
async function clearRepeats(queue: Queue): Promise<void> {
  const schedulers = await queue.getJobSchedulers();
  for (const s of schedulers) {
    if (s.key) await queue.removeJobScheduler(s.key);
  }
}

export async function setupRecurringJobs(): Promise<void> {
  const enabled: string[] = [];
  const disabled: string[] = [];

  if (config.jobs.healthCheckEnabled) {
    await healthCheckQueue.add(
      'check-all-machines',
      {},
      {
        repeat: { every: config.jobs.healthCheckIntervalS * 1000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 50 },
      },
    );
    enabled.push('health-check');
  } else {
    await clearRepeats(healthCheckQueue);
    disabled.push('health-check');
  }

  if (config.jobs.autoPullEnabled) {
    await autoPullQueue.add(
      'pull-all-machines',
      {},
      {
        repeat: { every: config.jobs.autoPullIntervalS * 1000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 50 },
      },
    );
    enabled.push('auto-pull');
  } else {
    await clearRepeats(autoPullQueue);
    disabled.push('auto-pull');
  }

  if (config.jobs.syncRetryEnabled) {
    await syncRetryQueue.add(
      'retry-failed-syncs',
      {},
      {
        repeat: { every: config.jobs.syncRetryIntervalS * 1000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 50 },
      },
    );
    enabled.push('sync-retry');
  } else {
    await clearRepeats(syncRetryQueue);
    disabled.push('sync-retry');
  }

  if (config.jobs.sessionSyncEnabled) {
    await sessionSyncQueue.add(
      'sync-all-sessions',
      {},
      {
        repeat: { every: config.jobs.sessionSyncIntervalS * 1000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 50 },
      },
    );
    enabled.push('session-sync');
  } else {
    await clearRepeats(sessionSyncQueue);
    disabled.push('session-sync');
  }

  if (config.jobs.logCollectorEnabled) {
    await logCollectorQueue.add(
      'collect-all-logs',
      {},
      {
        repeat: { every: config.jobs.logCollectorIntervalS * 1000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 50 },
      },
    );
    enabled.push('log-collector');
  } else {
    await clearRepeats(logCollectorQueue);
    disabled.push('log-collector');
  }

  if (config.jobs.evoClawEnabled) {
    await evoClawQueue.add(
      'evolve-all-agents',
      {},
      {
        repeat: { every: config.evoClaw.intervalS * 1000 },
        removeOnComplete: { count: 50 },
        removeOnFail: { count: 20 },
      },
    );
    enabled.push('evo-claw');
  } else {
    await clearRepeats(evoClawQueue);
    disabled.push('evo-claw');
  }

  if (config.jobs.summaryEnabled) {
    // Cron-pattern repeat runs the job on fixed wall-clock ticks in the
    // configured timezone (e.g. 00:00 and 12:00 Asia/Shanghai) rather than
    // rolling every N ms, which matches the product expectation of "daily
    // business recap at fixed times" and stays stable across restarts.
    await summaryQueue.add(
      'generate-summaries',
      {},
      {
        repeat: {
          pattern: config.summaries.cronPattern,
          tz: config.summaries.timezone,
        },
        removeOnComplete: { count: 50 },
        removeOnFail: { count: 20 },
      },
    );
    enabled.push('summary');
  } else {
    await clearRepeats(summaryQueue);
    disabled.push('summary');
  }

  if (config.jobs.dailyOssBackupEnabled) {
    // Iterates online machines once a day and pushes every non-draft agent
    // to OSS via DistillPushService. SHA-based diffing inside the service
    // already skips unchanged persona files, but raw memory / skills /
    // vector are re-uploaded — that's intentional and fine for a daily run.
    await dailyOssBackupQueue.add(
      'backup-all-agents',
      {},
      {
        repeat: {
          pattern: config.dailyOssBackup.cronPattern,
          tz: config.dailyOssBackup.timezone,
        },
        removeOnComplete: { count: 50 },
        removeOnFail: { count: 20 },
      },
    );
    enabled.push('daily-oss-backup');
  } else {
    await clearRepeats(dailyOssBackupQueue);
    disabled.push('daily-oss-backup');
  }

  log.info({ enabled, disabled }, 'Recurring jobs configured');
}
