export type SyncMode = 'hot' | 'warm' | 'cold';
export type SyncDirection = 'push' | 'pull' | 'bidirectional';
export type SyncOperationStatus = 'pending' | 'in_progress' | 'completed' | 'partial_failure' | 'failed';

export interface SyncOperation {
  id: string;
  machineId: string;
  syncType: SyncMode;
  syncDirection: SyncDirection;
  status: SyncOperationStatus;
  triggeredBy: string | null;
  totalFiles: number;
  syncedFiles: number;
  failedFiles: number;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  requiresRestart: boolean;
  restartPerformed: boolean;
  retryCount: number;
  createdAt: string;
}

export interface PullResult {
  operationId: string;
  status: string;
  remoteNew: number;
  remoteModified: number;
  remoteDeleted: number;
  totalPulled: number;
  durationMs: number;
}

export interface PushResult {
  operationId: string;
  status: string;
  syncMode: SyncMode;
  totalFiles?: number;
  syncedFiles: number;
  failedFiles: number;
  requiresRestart?: boolean;
  restartPerformed?: boolean;
  gatewayRestarted?: boolean;
  durationMs: number;
}

export interface SyncPlan {
  syncMode: SyncMode;
  filesToPush: { path: string; action: string; sizeBytes: number }[];
  conflicts: { path: string; localHash: string; remoteHash: string }[];
  requiresRestart: boolean;
  estimatedDurationMs: number;
}

export interface PushInput {
  files?: string[];
  forceSyncMode?: SyncMode;
  skipVerification?: boolean;
}
