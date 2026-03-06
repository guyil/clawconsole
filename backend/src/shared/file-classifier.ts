/**
 * File Classification System
 *
 * Classifies every file under ~/.openclaw/ into one of three categories
 * that determine sync behavior. See docs/FILE-CLASSIFICATION.md for details.
 */

export type FileCategory = 'console_managed' | 'runtime_observable' | 'system_internal';

export type FileType =
  | 'config'
  | 'persona'
  | 'skill'
  | 'credential'
  | 'cron'
  | 'hook'
  | 'log'
  | 'session'
  | 'memory'
  | 'other';

const SYSTEM_INTERNAL_PATTERNS: RegExp[] = [
  /^identity\//,
  /^update-check\.json$/,
  /^openclaw\.json\.bak/,
  /^workspace(-[^/]+)?\/\.git\//,
  /^workspace(-[^/]+)?\/\.openclaw\//,
  /^completions\//,
  /^browser\//,
  /^canvas\//,
];

const RUNTIME_OBSERVABLE_PATTERNS: RegExp[] = [
  /^agents\/.+/,
  /^memory\/.+/,
  /^workspace(-[^/]+)?\/memory\/.+/,
  /^logs\/.+/,
  /^cron\/runs\/.+/,
  /^subagents\/.+/,
  /^delivery-queue\/.+/,
  /^feishu\/.+/,
  /^devices\/.+/,
];

const CONSOLE_MANAGED_PATTERNS: RegExp[] = [
  /^openclaw\.json$/,
  /^workspace(-[^/]+)?\/(SOUL|IDENTITY|USER|AGENTS|TOOLS|BOOTSTRAP|HEARTBEAT|README)\.md$/,
  /^workspace(-[^/]+)?\/skills\/.+/,
  /^workspace(-[^/]+)?\/config\/.+/,
  /^skills\/.+/,
  /^hooks\/.+/,
  /^cron\/jobs\.json$/,
  /^credentials\/.+\.json$/,
];

export function classifyFile(relativePath: string): FileCategory {
  const normalized = relativePath.replace(/^\.\//, '');

  if (SYSTEM_INTERNAL_PATTERNS.some((p) => p.test(normalized))) return 'system_internal';
  if (RUNTIME_OBSERVABLE_PATTERNS.some((p) => p.test(normalized))) return 'runtime_observable';
  if (CONSOLE_MANAGED_PATTERNS.some((p) => p.test(normalized))) return 'console_managed';
  return 'system_internal';
}

export function detectFileType(relativePath: string): FileType {
  const normalized = relativePath.replace(/^\.\//, '');

  if (normalized === 'openclaw.json') return 'config';
  if (/\/(SOUL|IDENTITY|USER|AGENTS|TOOLS|BOOTSTRAP|HEARTBEAT|README)\.md$/.test(normalized)) return 'persona';
  if (/\/skills\//.test(normalized) || /^skills\//.test(normalized)) return 'skill';
  if (/^credentials\//.test(normalized)) return 'credential';
  if (/^cron\//.test(normalized)) return 'cron';
  if (/^hooks\//.test(normalized)) return 'hook';
  if (/^logs\//.test(normalized)) return 'log';
  if (/\/sessions\//.test(normalized) || /^agents\//.test(normalized)) return 'session';
  if (/\/memory\//.test(normalized) || /^memory\//.test(normalized)) return 'memory';
  if (/\/config\//.test(normalized)) return 'config';
  return 'other';
}

export function extractAgentId(relativePath: string): string | null {
  const normalized = relativePath.replace(/^\.\//, '');

  const workspaceMatch = normalized.match(/^workspace-([^/]+)\//);
  if (workspaceMatch) return workspaceMatch[1];

  if (normalized.startsWith('workspace/')) return 'main';

  const agentDirMatch = normalized.match(/^agents\/([^/]+)\//);
  if (agentDirMatch) return agentDirMatch[1];

  const memoryMatch = normalized.match(/^memory\/([^.]+)\.sqlite$/);
  if (memoryMatch) return memoryMatch[1];

  return null;
}

export function isExcludedFromSync(relativePath: string): boolean {
  const normalized = relativePath.replace(/^\.\//, '');
  const excludePatterns = [
    /\.sqlite$/,
    /\.sqlite-wal$/,
    /\.sqlite-shm$/,
    /^identity\//,
    /^browser\//,
    /^canvas\//,
    /^completions\//,
    /\.git\//,
    /^update-check\.json$/,
    /\.bak/,
  ];
  return excludePatterns.some((p) => p.test(normalized));
}
