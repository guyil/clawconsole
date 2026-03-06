export type ConfigSessionStatus = 'active' | 'idle';

export interface ConfigFileSnapshot {
  filename: string;
  originalContent: string;
  currentContent: string;
  dirty: boolean;
}

export interface ConfigChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
}

export interface ConfigChatSession {
  id: string;
  agentId: string;
  machineId: string;
  status: ConfigSessionStatus;
  messages: ConfigChatMessage[];
  /** Workspace-relative path prefix, e.g. "workspace" or "workspace-pm" */
  workspacePath: string;
  /** Snapshot of config files at session start, keyed by filename */
  files: Map<string, ConfigFileSnapshot>;
  createdAt: Date;
  lastActivityAt: Date;
}

export interface PendingChange {
  filename: string;
  originalContent: string;
  currentContent: string;
  /** Managed file ID in the database (null if file was created during session) */
  managedFileId: string | null;
}

export interface SyncConfigResult {
  syncedFiles: number;
  failedFiles: number;
  errors: string[];
}
