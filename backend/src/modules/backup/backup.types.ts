/**
 * Backup module types.
 *
 * The backup pipeline orchestrates the existing sync/monitoring services
 * to produce a self-contained on-disk snapshot of a single machine's
 * OpenClaw state — persona/config files, memory markdown, skills,
 * sessions, and full transcripts. The output is plain text/JSON so it
 * can be browsed, grep'd, git-tracked, or re-imported elsewhere.
 */

export type BackupStep =
  | 'init'
  | 'pull-files'
  | 'pull-sessions'
  | 'pull-transcripts'
  | 'export-files'
  | 'export-sessions'
  | 'export-skills'
  | 'manifest'
  | 'done'
  | 'error';

export type BackupStatus = 'running' | 'success' | 'error';

export interface BackupProgressEvent {
  step: BackupStep;
  status: BackupStatus;
  message: string;
  /** Index of current item in the step (1-based), if step iterates. */
  current?: number;
  /** Total items in the step, if step iterates. */
  total?: number;
  /** Free-form per-step extras (counts, errors, output dir, etc.). */
  detail?: Record<string, unknown>;
}

export interface BackupOptions {
  /**
   * Skip the remote refresh phase and export whatever is already in the
   * local DB cache. Useful for re-exporting an older snapshot to a new
   * directory without hitting the remote machine again.
   */
  skipRefresh?: boolean;
  /**
   * Cap on how many session snapshots to back up (newest first by
   * lastActivityAt). Default 500 matches what the UI/manifest uses.
   */
  maxSessions?: number;
}

export interface BackupResult {
  outputDir: string;
  machineId: string;
  machineName: string;
  totalFiles: number;
  totalSessions: number;
  totalMessages: number;
  totalSkills: number;
  durationMs: number;
}
