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

export async function setupRecurringJobs(): Promise<void> {
  await healthCheckQueue.add(
    'check-all-machines',
    {},
    {
      repeat: { every: config.jobs.healthCheckIntervalS * 1000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
    },
  );

  await autoPullQueue.add(
    'pull-all-machines',
    {},
    {
      repeat: { every: config.jobs.autoPullIntervalS * 1000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
    },
  );

  await syncRetryQueue.add(
    'retry-failed-syncs',
    {},
    {
      repeat: { every: config.jobs.syncRetryIntervalS * 1000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
    },
  );

  await sessionSyncQueue.add(
    'sync-all-sessions',
    {},
    {
      repeat: { every: config.jobs.sessionSyncIntervalS * 1000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
    },
  );

  await logCollectorQueue.add(
    'collect-all-logs',
    {},
    {
      repeat: { every: config.jobs.logCollectorIntervalS * 1000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
    },
  );

  log.info('Recurring jobs configured');
}
