export type AgentStatus = 'draft' | 'packaging' | 'syncing' | 'online' | 'degraded' | 'offline' | 'archived';

export type AgentModelValue = string | { primary: string; fallbacks?: string[] };

export interface AgentModelConfig {
  model: AgentModelValue;
  lastSyncedAt?: string;
}

export type OssSyncStatus = 'ok' | 'failed';

/**
 * Snapshot of the most recent OSS distill push for one agent. Written by
 * ``DistillPushService.pushAgent`` after each attempt (success OR failure)
 * and read by the status API so the UI can render "last shipped …" badges
 * without having to tail pino logs or list the OSS bucket.
 *
 * NOTE: ``lastSyncedAt`` on the parent ``Agent`` interface tracks SSH file
 * refreshes (memory/config pulls) and is a separate timeline.
 */
export interface AgentOssSyncState {
  lastOssSyncAt: Date | null;
  lastOssSyncStatus: OssSyncStatus | null;
  lastOssSyncError: string | null;
  lastOssVectorSha: string | null;
  lastOssDurationMs: number | null;
}

export interface Agent extends AgentOssSyncState {
  id: string;
  machineId: string;
  agentId: string;
  name: string | null;
  description: string | null;
  isDefault: boolean;
  workspacePath: string | null;
  discoveredSkills: string[] | null;
  modelConfig: AgentModelConfig | null;
  status: AgentStatus;
  lastSyncedAt: Date | null;
  /**
   * Whether the daily ``daily-oss-backup`` cron includes this agent. Manual
   * push-to-oss endpoints (``/api/distill/push-to-oss/single`` etc.) ignore
   * this flag — turning it off only opts the bot out of the nightly run.
   */
  ossSyncEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateAgentInput {
  machineId: string;
  agentId: string;
  name?: string;
  description?: string;
  isDefault?: boolean;
  workspacePath?: string;
}

export interface UpdateAgentInput {
  /**
   * `null` clears the field so the UI falls back to displaying `agentId`.
   * `undefined` leaves it unchanged. Same convention for `description`.
   */
  name?: string | null;
  description?: string | null;
  status?: AgentStatus;
  modelConfig?: AgentModelConfig | null;
  /**
   * Toggle for the nightly OSS distill backup. ``undefined`` leaves the
   * stored value alone; ``true`` / ``false`` overwrite it.
   */
  ossSyncEnabled?: boolean;
}
