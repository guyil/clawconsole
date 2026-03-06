export interface ParsedCronJob {
  id: string;
  agentId?: string;
  name: string;
  description?: string;
  enabled: boolean;
  schedule: CronSchedule;
  sessionTarget?: string;
  wakeMode?: string;
  payload?: CronPayload;
  delivery?: CronDelivery;
  state?: CronJobState;
}

export type CronSchedule =
  | { kind: 'at'; at: string }
  | { kind: 'every'; everyMs: number; anchorMs?: number }
  | { kind: 'cron'; expr: string; tz?: string; staggerMs?: number };

export interface CronPayload {
  kind: string;
  message?: string;
  text?: string;
}

export interface CronDelivery {
  mode: string;
  channel?: string;
  to?: string;
  accountId?: string;
}

export interface CronJobState {
  nextRunAtMs?: number;
  lastRunAtMs?: number;
  lastRunStatus?: string;
  lastError?: string;
  consecutiveErrors?: number;
}

export interface ParsedCronStore {
  version: number;
  jobs: ParsedCronJob[];
}

export function parseCronJobsJson(content: string): ParsedCronStore {
  const data = JSON.parse(content) as ParsedCronStore;
  return {
    version: data.version ?? 1,
    jobs: (data.jobs ?? []).map((job) => ({
      id: job.id,
      agentId: job.agentId,
      name: job.name ?? '',
      description: job.description,
      enabled: job.enabled ?? true,
      schedule: job.schedule,
      sessionTarget: job.sessionTarget,
      wakeMode: job.wakeMode,
      payload: job.payload,
      delivery: job.delivery,
      state: job.state,
    })),
  };
}

export function serializeCronJobsJson(store: ParsedCronStore): string {
  return JSON.stringify(store, null, 2);
}
