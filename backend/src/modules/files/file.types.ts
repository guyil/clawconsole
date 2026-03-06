import type { FileCategory, FileType } from '../../shared/file-classifier.js';

export interface ManagedFile {
  id: string;
  machineId: string;
  agentId: string | null;
  relativePath: string;
  fileCategory: FileCategory;
  fileType: FileType;
  content: string | null;
  contentHash: string | null;
  remoteHash: string | null;
  remoteMtime: number | null;
  remoteSize: number | null;
  localDirty: boolean;
  remoteDirty: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpdateFileContentInput {
  content: string;
}

export interface FileListFilters {
  category?: FileCategory;
  type?: FileType;
  agentId?: string;
  dirty?: boolean;
}
