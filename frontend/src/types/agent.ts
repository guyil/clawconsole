export type AgentStatus = 'draft' | 'packaging' | 'syncing' | 'online' | 'degraded' | 'offline' | 'archived';

export type AgentModelValue = string | { primary: string; fallbacks?: string[] };

export interface AgentModelConfig {
  model: AgentModelValue;
  lastSyncedAt?: string;
}

export type OssSyncStatus = 'ok' | 'failed';

export interface Agent {
  id: string;
  machineId: string;
  agentId: string;
  name: string | null;
  description: string | null;
  isDefault: boolean;
  workspacePath: string | null;
  /** Per-bot 数据中台 sender identity for data permission. Null → global operator. */
  dataUserId: string | null;
  dataUserName: string | null;
  discoveredSkills: string[] | null;
  modelConfig: AgentModelConfig | null;
  status: AgentStatus;
  lastSyncedAt: string | null;
  /**
   * Whether the daily ``daily-oss-backup`` cron includes this bot. Manual
   * "推送到 Mini Claw" / "Push to OSS" actions ignore this flag — flipping
   * it off only removes the bot from the nightly run.
   */
  ossSyncEnabled: boolean;
  /** Wall-clock end time of the most recent OSS distill push. NULL = never. */
  lastOssSyncAt: string | null;
  /** 'ok' on success, 'failed' on any thrown error, NULL if never tried. */
  lastOssSyncStatus: OssSyncStatus | null;
  /** Truncated error message from the most recent failed push. */
  lastOssSyncError: string | null;
  /** sha256 of the vector sqlite uploaded by the most recent successful push. */
  lastOssVectorSha: string | null;
  /** Wall-clock duration in ms of the most recent push attempt. */
  lastOssDurationMs: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAgentInput {
  agentId: string;
  name?: string;
  description?: string;
  isDefault?: boolean;
}

export interface UpdateAgentInput {
  /**
   * `null` clears the field on the backend so the UI falls back to
   * displaying ``agentId``. ``undefined`` leaves it unchanged.
   */
  name?: string | null;
  description?: string | null;
  status?: AgentStatus;
  modelConfig?: AgentModelConfig | null;
  /**
   * Toggle the per-bot opt-in for the nightly OSS distill cron.
   * ``undefined`` leaves the stored value alone.
   */
  ossSyncEnabled?: boolean;
  /** Per-bot 数据中台 sender identity. `null` clears it (falls back to global operator). */
  dataUserId?: string | null;
  dataUserName?: string | null;
}

export interface AgentWithMachine extends Agent {
  machineName: string;
  machineHostname: string;
  machineStatus: string;
  globalSkills: string[];
}

export interface AgentDetail extends Agent {
  globalSkills: string[];
}

export interface AgentConfigFile {
  id: string;
  filename: string;
  relativePath: string;
  content: string;
  localDirty: boolean;
  remoteDirty: boolean;
  updatedAt?: string;
}

export interface ProvisionChannelInput {
  channelType: string;
  accountId: string;
  token?: string;
  signingSecret?: string;
  encryptKey?: string;
}

export interface ProvisionInput {
  channels?: ProvisionChannelInput[];
  copyFromAgentId?: string;
}

export interface ProvisionEvent {
  step: string;
  status: 'running' | 'success' | 'error';
  message: string;
  detail?: string;
}
