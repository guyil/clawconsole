export type MemoryCategory = 'core' | 'daily' | 'session_snapshot';

export interface MemoryFile {
  id: string;
  filename: string;
  relativePath: string;
  content: string;
  category: MemoryCategory;
  mtime: number | null;
  size: number | null;
  updatedAt: string;
}

export interface MemoryFilesResponse {
  data: {
    core: MemoryFile[];
    daily: MemoryFile[];
    sessionSnapshots: MemoryFile[];
  };
  totalFiles: number;
  lastSyncedAt: string | null;
  stale?: boolean;
}
