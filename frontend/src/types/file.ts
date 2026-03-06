export type FileCategory = 'console_managed' | 'runtime_observable' | 'system_internal';
export type FileType = 'config' | 'persona' | 'skill' | 'credential' | 'cron' | 'hook' | 'log' | 'session' | 'memory' | 'other';

export interface ManagedFile {
  id: string;
  machineId: string;
  agentId: string | null;
  relativePath: string;
  fileCategory: FileCategory;
  fileType: FileType;
  content?: string;
  contentHash: string | null;
  remoteHash: string | null;
  localDirty: boolean;
  remoteDirty: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface FileListFilters {
  category?: FileCategory;
  type?: FileType;
  agentId?: string;
  dirty?: boolean;
}
