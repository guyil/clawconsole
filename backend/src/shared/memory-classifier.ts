import path from 'node:path';

export type MemoryCategory = 'core' | 'daily' | 'session_snapshot';

const DAILY_PATTERN = /^\d{4}-\d{2}-\d{2}\.md$/;

export function classifyMemoryFile(relativePath: string): MemoryCategory {
  const filename = path.basename(relativePath);
  if (filename === 'MEMORY.md' || filename === 'memory.md') return 'core';
  if (DAILY_PATTERN.test(filename)) return 'daily';
  return 'session_snapshot';
}

export interface MemoryFileRecord {
  id: string;
  relativePath: string;
  filename: string;
  content: string;
  category: MemoryCategory;
  mtime: number | null;
  size: number | null;
  updatedAt: Date;
}
