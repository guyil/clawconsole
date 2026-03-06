export interface ManifestEntry {
  relativePath: string;
  hash: string;
  size: number;
  mtime: number;
}

export interface RemoteManifest {
  machineId: string;
  collectedAt: Date;
  entries: ManifestEntry[];
}

export type SyncMode = 'hot' | 'warm' | 'cold';
export type SyncDirection = 'push' | 'pull' | 'bidirectional';
export type SyncOperationStatus = 'pending' | 'in_progress' | 'completed' | 'partial_failure' | 'failed';
export type FileTransferAction = 'create' | 'update' | 'delete' | 'skip' | 'conflict';
export type FileTransferStatus = 'pending' | 'completed' | 'failed' | 'skipped';

export interface LocalFileState {
  id: string;
  relativePath: string;
  contentHash: string | null;
  remoteHash: string | null;
  localDirty: boolean;
  content: string | null;
}

export interface DiffResult {
  remoteNew: ManifestEntry[];
  remoteModified: ManifestEntry[];
  remoteDeleted: string[];
  localDirty: LocalDirtyFile[];
  conflicts: ConflictEntry[];
  unchanged: string[];
}

export interface LocalDirtyFile {
  id: string;
  relativePath: string;
  contentHash: string;
  content: string;
}

export interface ConflictEntry {
  relativePath: string;
  fileId: string;
  localContent: string;
  localHash: string;
  remoteHash: string;
  lastKnownRemoteHash: string;
}

export type ConflictStrategy = 'local_wins' | 'remote_wins' | 'user_decides';

export interface SyncPlan {
  mode: SyncMode;
  filesToPush: FileToPush[];
  filesToPull: FileToPull[];
  conflicts: ConflictEntry[];
  requiresRestart: boolean;
  estimatedDurationMs: number;
}

export interface FileToPush {
  relativePath: string;
  fileId: string;
  content: string;
  action: FileTransferAction;
}

export interface FileToPull {
  relativePath: string;
  action: FileTransferAction;
  remoteHash: string;
  remoteSize: number;
}

export interface SyncResult {
  operationId: string;
  status: SyncOperationStatus;
  syncMode: SyncMode;
  direction: SyncDirection;
  totalFiles: number;
  syncedFiles: number;
  failedFiles: number;
  conflicts: ConflictEntry[];
  requiresRestart: boolean;
  restartPerformed: boolean;
  durationMs: number;
  errors: SyncFileError[];
}

export interface SyncFileError {
  relativePath: string;
  error: string;
  canRetry: boolean;
}

export interface SyncOperationRecord {
  id: string;
  machineId: string;
  syncType: SyncMode | 'pull' | 'full_pull';
  syncDirection: SyncDirection;
  status: SyncOperationStatus;
  triggeredBy: string | null;
  totalFiles: number;
  syncedFiles: number;
  failedFiles: number;
  errorMessage: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  durationMs: number | null;
  requiresRestart: boolean;
  restartPerformed: boolean;
  retryCount: number;
  parentOperationId: string | null;
  createdAt: Date;
}
