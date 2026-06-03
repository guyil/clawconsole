/**
 * Wire types for ``GET /api/distill/push-to-oss/status``.
 *
 * Mirrors the JSON shape produced by ``distill-push.routes.ts``. Keep
 * fields nullable where the backend can legitimately not have data
 * (no Redis connection, no daily-oss-backup runs yet, agent never
 * pushed since the column was added, etc.) — the UI must tolerate
 * NULL everywhere without crashing.
 */
import type { OssSyncStatus, AgentStatus } from './agent';

export interface DistillStatusCron {
  enabled: boolean;
  pattern: string;
  timezone: string;
  concurrency: number;
  perAgentTimeoutMs: number;
  /** ISO-8601 wall-clock for the next scheduled run, or null. */
  nextRunAt: string | null;
}

export interface DistillStatusRun {
  id: string | null;
  name: string | null;
  /** ISO-8601 enqueue time. */
  timestamp: string | null;
  /** ISO-8601 finish time, or null if the run hasn't finished. */
  finishedAt: string | null;
  status: 'completed' | 'failed';
  /** Total wall-clock duration in ms (processedOn → finishedOn). */
  durationMs: number | null;
  failedReason?: string | null;
  attemptsMade?: number;
}

export interface DistillStatusAgent {
  agentDbId: string;
  agentId: string;
  name: string | null;
  machineId: string;
  machineAlias: string;
  machineName: string;
  machineStatus: string;
  status: AgentStatus;
  /**
   * Per-bot opt-in for the nightly cron. ``false`` means this bot is
   * deliberately excluded from ``daily-oss-backup`` — render the row as
   * "已禁用" instead of yellow "从未".
   */
  ossSyncEnabled: boolean;
  /** ISO-8601 of the most recent OSS push attempt. NULL = never. */
  lastOssSyncAt: string | null;
  lastOssSyncStatus: OssSyncStatus | null;
  lastOssSyncError: string | null;
  lastOssVectorSha: string | null;
  lastOssDurationMs: number | null;
}

export interface DistillStatusSummary {
  total: number;
  ok: number;
  failed: number;
  neverSynced: number;
  /**
   * Number of agents whose owner opted out of the nightly cron. They're
   * counted here so the dashboard can show "X 个已禁用" without having to
   * re-derive it from ``agents[]``.
   */
  disabled: number;
  /** Number of agents currently being distilled (waiting + active). */
  inFlight: number;
  /** ISO-8601 of the oldest non-null lastOssSyncAt across all agents. */
  oldestSyncAt: string | null;
}

/**
 * One in-flight job from the manual-oss-distill BullMQ queue. Used by the
 * dashboard to render a "正在蒸馏…" badge on the matching agent row, and
 * to bump the polling cadence while any job is active.
 */
export interface DistillStatusInFlight {
  jobId: string;
  agentDbId: string;
  agentId: string | null;
  machineAlias: string | null;
  state: 'waiting' | 'active';
  /** ISO-8601 of when the job was enqueued. */
  enqueuedAt: string | null;
  /** ISO-8601 of when a worker started processing, or null while waiting. */
  startedAt: string | null;
}

export interface DistillStatus {
  cron: DistillStatusCron;
  recentRuns: DistillStatusRun[];
  /** Currently queued / running manual distill jobs. Empty when idle. */
  inFlight: DistillStatusInFlight[];
  summary: DistillStatusSummary;
  agents: DistillStatusAgent[];
}
