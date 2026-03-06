import { v4 as uuidv4 } from 'uuid';
import type { SSHConnectionInfo } from '../../transport/ssh-pool.js';
import type { FileTransfer } from '../../transport/file-transfer.js';
import type { SSHExecutor } from '../../transport/ssh-executor.js';
import type { ManifestCollector } from './manifest-collector.js';
import type { DiffEngine } from './diff-engine.js';
import type {
  LocalFileState,
  SyncPlan,
  SyncResult,
  SyncOperationStatus,
  FileToPush,
  FileToPull,
  SyncFileError,
  RemoteManifest,
  DiffResult,
} from './sync.types.js';
import { detectSyncMode, requiresGatewayRestart } from './sync-mode-detector.js';
import { autoResolveConflicts } from './conflict-resolver.js';
import { hashContent } from '../../shared/crypto.js';
import { createChildLogger } from '../../shared/logger.js';
import {
  emitSyncStarted,
  emitSyncProgress,
  emitSyncCompleted,
  emitSyncConflict,
} from '../../websocket/sync-events.js';

const log = createChildLogger('sync-engine');

export interface SyncEngineDeps {
  manifestCollector: ManifestCollector;
  diffEngine: DiffEngine;
  fileTransfer: FileTransfer;
  sshExecutor: SSHExecutor;
  fileRepository: FileRepositoryInterface;
  syncRepository: SyncRepositoryInterface;
}

export interface FileRepositoryInterface {
  findByMachineId(machineId: string): Promise<LocalFileState[]>;
  upsertFile(params: {
    machineId: string;
    relativePath: string;
    content: string | null;
    contentHash: string | null;
    remoteHash: string | null;
    remoteMtime: number | null;
    remoteSize: number | null;
    localDirty: boolean;
    remoteDirty: boolean;
  }): Promise<string>;
  clearLocalDirty(fileId: string): Promise<void>;
  clearRemoteDirty(fileId: string): Promise<void>;
  setRemoteDirty(machineId: string, paths: string[]): Promise<void>;
  getDirtyFiles(machineId: string): Promise<LocalFileState[]>;
}

export interface SyncRepositoryInterface {
  createOperation(params: {
    id: string;
    machineId: string;
    syncType: string;
    syncDirection: string;
    triggeredBy: string;
    totalFiles: number;
    requiresRestart: boolean;
  }): Promise<void>;
  updateOperationStatus(params: {
    id: string;
    status: SyncOperationStatus;
    syncedFiles: number;
    failedFiles: number;
    errorMessage: string | null;
    completedAt: Date | null;
    durationMs: number | null;
    restartPerformed: boolean;
  }): Promise<void>;
  createOperationFile(params: {
    id: string;
    syncOperationId: string;
    managedFileId: string | null;
    relativePath: string;
    action: string;
    status: string;
    beforeHash: string | null;
    afterHash: string | null;
    fileSizeBytes: number | null;
    errorMessage: string | null;
  }): Promise<void>;
}

export class SyncEngine {
  private manifestCollector: ManifestCollector;
  private diffEngine: DiffEngine;
  private fileTransfer: FileTransfer;
  private sshExecutor: SSHExecutor;
  private fileRepo: FileRepositoryInterface;
  private syncRepo: SyncRepositoryInterface;

  constructor(deps: SyncEngineDeps) {
    this.manifestCollector = deps.manifestCollector;
    this.diffEngine = deps.diffEngine;
    this.fileTransfer = deps.fileTransfer;
    this.sshExecutor = deps.sshExecutor;
    this.fileRepo = deps.fileRepository;
    this.syncRepo = deps.syncRepository;
  }

  async collectManifest(
    connectionInfo: SSHConnectionInfo,
    openclawHome: string,
  ): Promise<RemoteManifest> {
    return this.manifestCollector.collect(connectionInfo, openclawHome);
  }

  async buildSyncPlan(
    machineId: string,
    connectionInfo: SSHConnectionInfo,
    openclawHome: string,
  ): Promise<{ plan: SyncPlan; diff: DiffResult }> {
    const manifest = await this.collectManifest(connectionInfo, openclawHome);
    const localFiles = await this.fileRepo.findByMachineId(machineId);
    const diff = this.diffEngine.computeDiff(localFiles, manifest);

    const filesToPull: FileToPull[] = [
      ...diff.remoteNew.map((e) => ({
        relativePath: e.relativePath,
        action: 'create' as const,
        remoteHash: e.hash,
        remoteSize: e.size,
      })),
      ...diff.remoteModified.map((e) => ({
        relativePath: e.relativePath,
        action: 'update' as const,
        remoteHash: e.hash,
        remoteSize: e.size,
      })),
    ];

    const filesToPush: FileToPush[] = diff.localDirty.map((f) => ({
      relativePath: f.relativePath,
      fileId: f.id,
      content: f.content,
      action: 'update',
    }));

    const pushPaths = filesToPush.map((f) => f.relativePath);
    const mode = detectSyncMode(pushPaths);
    const restart = requiresGatewayRestart(mode);

    const plan: SyncPlan = {
      mode,
      filesToPush,
      filesToPull,
      conflicts: diff.conflicts,
      requiresRestart: restart,
      estimatedDurationMs: this.estimateDuration(mode, filesToPush.length + filesToPull.length),
    };

    return { plan, diff };
  }

  async executePull(
    machineId: string,
    connectionInfo: SSHConnectionInfo,
    openclawHome: string,
    triggeredBy: string,
  ): Promise<SyncResult> {
    const operationId = uuidv4();
    const startTime = Date.now();

    const manifest = await this.collectManifest(connectionInfo, openclawHome);
    const localFiles = await this.fileRepo.findByMachineId(machineId);
    const diff = this.diffEngine.computeDiff(localFiles, manifest);

    const filesToPull = [...diff.remoteNew, ...diff.remoteModified];
    const totalFiles = filesToPull.length;

    await this.syncRepo.createOperation({
      id: operationId,
      machineId,
      syncType: 'pull',
      syncDirection: 'pull',
      triggeredBy,
      totalFiles,
      requiresRestart: false,
    });

    emitSyncStarted({ operationId, machineId, syncType: 'pull', direction: 'pull' });

    let syncedFiles = 0;
    let failedFiles = 0;
    const errors: SyncFileError[] = [];

    for (let i = 0; i < filesToPull.length; i++) {
      const entry = filesToPull[i];
      const opFileId = uuidv4();
      try {
        const remotePath = `${openclawHome}/${entry.relativePath}`;
        const content = await this.fileTransfer.downloadFile(connectionInfo, remotePath);
        const contentHash = hashContent(content);

        await this.fileRepo.upsertFile({
          machineId,
          relativePath: entry.relativePath,
          content,
          contentHash,
          remoteHash: entry.hash,
          remoteMtime: entry.mtime,
          remoteSize: entry.size,
          localDirty: false,
          remoteDirty: false,
        });

        await this.syncRepo.createOperationFile({
          id: opFileId,
          syncOperationId: operationId,
          managedFileId: null,
          relativePath: entry.relativePath,
          action: diff.remoteNew.includes(entry) ? 'create' : 'update',
          status: 'completed',
          beforeHash: null,
          afterHash: contentHash,
          fileSizeBytes: entry.size,
          errorMessage: null,
        });

        syncedFiles++;
        emitSyncProgress({
          operationId, file: entry.relativePath, action: 'pull',
          status: 'completed', current: i + 1, total: totalFiles,
        });
      } catch (err) {
        failedFiles++;
        const errMsg = err instanceof Error ? err.message : String(err);
        errors.push({ relativePath: entry.relativePath, error: errMsg, canRetry: true });

        await this.syncRepo.createOperationFile({
          id: opFileId,
          syncOperationId: operationId,
          managedFileId: null,
          relativePath: entry.relativePath,
          action: 'update',
          status: 'failed',
          beforeHash: null,
          afterHash: null,
          fileSizeBytes: null,
          errorMessage: errMsg,
        });

        emitSyncProgress({
          operationId, file: entry.relativePath, action: 'pull',
          status: 'failed', current: i + 1, total: totalFiles,
        });
      }
    }

    if (diff.remoteDeleted.length > 0) {
      await this.fileRepo.setRemoteDirty(machineId, diff.remoteDeleted);
    }

    if (diff.conflicts.length > 0) {
      emitSyncConflict({
        operationId,
        conflicts: diff.conflicts.map((c) => ({
          path: c.relativePath, localHash: c.localHash, remoteHash: c.remoteHash,
        })),
      });
    }

    const durationMs = Date.now() - startTime;
    const status: SyncOperationStatus =
      failedFiles === 0 ? 'completed' : totalFiles === failedFiles ? 'failed' : 'partial_failure';

    await this.syncRepo.updateOperationStatus({
      id: operationId,
      status,
      syncedFiles,
      failedFiles,
      errorMessage: errors.length > 0 ? errors.map((e) => `${e.relativePath}: ${e.error}`).join('; ') : null,
      completedAt: new Date(),
      durationMs,
      restartPerformed: false,
    });

    emitSyncCompleted({
      operationId, status, syncMode: 'hot', syncedFiles, failedFiles, durationMs,
    });

    log.info({ operationId, status, syncedFiles, failedFiles, durationMs }, 'Pull completed');

    return {
      operationId,
      status,
      syncMode: 'hot',
      direction: 'pull',
      totalFiles,
      syncedFiles,
      failedFiles,
      conflicts: diff.conflicts,
      requiresRestart: false,
      restartPerformed: false,
      durationMs,
      errors,
    };
  }

  async executePush(
    machineId: string,
    connectionInfo: SSHConnectionInfo,
    openclawHome: string,
    triggeredBy: string,
    specificFiles?: string[],
  ): Promise<SyncResult> {
    const operationId = uuidv4();
    const startTime = Date.now();

    let dirtyFiles = await this.fileRepo.getDirtyFiles(machineId);
    if (specificFiles && specificFiles.length > 0) {
      dirtyFiles = dirtyFiles.filter((f) => specificFiles.includes(f.relativePath));
    }

    const pushPaths = dirtyFiles.map((f) => f.relativePath);
    const mode = detectSyncMode(pushPaths);
    const restart = requiresGatewayRestart(mode);

    await this.syncRepo.createOperation({
      id: operationId,
      machineId,
      syncType: mode,
      syncDirection: 'push',
      triggeredBy,
      totalFiles: dirtyFiles.length,
      requiresRestart: restart,
    });

    emitSyncStarted({ operationId, machineId, syncType: mode, direction: 'push' });

    let syncedFiles = 0;
    let failedFiles = 0;
    const errors: SyncFileError[] = [];

    for (let i = 0; i < dirtyFiles.length; i++) {
      const file = dirtyFiles[i];
      const opFileId = uuidv4();
      try {
        const remotePath = `${openclawHome}/${file.relativePath}`;

        const dir = remotePath.substring(0, remotePath.lastIndexOf('/'));
        await this.fileTransfer.ensureDirectory(connectionInfo, dir);
        await this.fileTransfer.uploadFile(connectionInfo, remotePath, file.content ?? '');

        const remoteHash = await this.fileTransfer.getRemoteFileHash(connectionInfo, remotePath);
        if (remoteHash && remoteHash !== file.contentHash) {
          log.warn(
            { relativePath: file.relativePath, expected: file.contentHash, actual: remoteHash },
            'Hash mismatch after upload',
          );
        }

        await this.fileRepo.clearLocalDirty(file.id);

        await this.syncRepo.createOperationFile({
          id: opFileId,
          syncOperationId: operationId,
          managedFileId: file.id,
          relativePath: file.relativePath,
          action: 'update',
          status: 'completed',
          beforeHash: file.contentHash,
          afterHash: remoteHash,
          fileSizeBytes: file.content?.length ?? null,
          errorMessage: null,
        });

        syncedFiles++;
        emitSyncProgress({
          operationId, file: file.relativePath, action: 'push',
          status: 'completed', current: i + 1, total: dirtyFiles.length,
        });
      } catch (err) {
        failedFiles++;
        const errMsg = err instanceof Error ? err.message : String(err);
        errors.push({ relativePath: file.relativePath, error: errMsg, canRetry: true });

        await this.syncRepo.createOperationFile({
          id: opFileId,
          syncOperationId: operationId,
          managedFileId: file.id,
          relativePath: file.relativePath,
          action: 'update',
          status: 'failed',
          beforeHash: null,
          afterHash: null,
          fileSizeBytes: null,
          errorMessage: errMsg,
        });

        emitSyncProgress({
          operationId, file: file.relativePath, action: 'push',
          status: 'failed', current: i + 1, total: dirtyFiles.length,
        });
      }
    }

    let restartPerformed = false;
    if (restart && failedFiles < dirtyFiles.length) {
      restartPerformed = await this.sshExecutor.restartGateway(connectionInfo);
    }

    const durationMs = Date.now() - startTime;
    const status: SyncOperationStatus =
      failedFiles === 0 ? 'completed' : dirtyFiles.length === failedFiles ? 'failed' : 'partial_failure';

    await this.syncRepo.updateOperationStatus({
      id: operationId,
      status,
      syncedFiles,
      failedFiles,
      errorMessage: errors.length > 0 ? errors.map((e) => `${e.relativePath}: ${e.error}`).join('; ') : null,
      completedAt: new Date(),
      durationMs,
      restartPerformed,
    });

    await this.manifestCollector.invalidateCache(machineId);

    emitSyncCompleted({
      operationId, status, syncMode: mode, syncedFiles, failedFiles, durationMs,
    });

    log.info({ operationId, mode, status, syncedFiles, failedFiles, durationMs, restartPerformed }, 'Push completed');

    return {
      operationId,
      status,
      syncMode: mode,
      direction: 'push',
      totalFiles: dirtyFiles.length,
      syncedFiles,
      failedFiles,
      conflicts: [],
      requiresRestart: restart,
      restartPerformed,
      durationMs,
      errors,
    };
  }

  async fullSync(
    machineId: string,
    connectionInfo: SSHConnectionInfo,
    openclawHome: string,
    triggeredBy: string,
  ): Promise<SyncResult> {
    log.info({ machineId, triggeredBy }, 'Starting full bidirectional sync');

    const pullResult = await this.executePull(machineId, connectionInfo, openclawHome, triggeredBy);
    if (pullResult.conflicts.length > 0) {
      const { autoResolved, needsUserInput } = autoResolveConflicts(pullResult.conflicts);

      for (const resolution of autoResolved) {
        if (resolution.strategy === 'remote_wins') {
          const entry = pullResult.conflicts.find((c) => c.relativePath === resolution.relativePath);
          if (entry) {
            await this.fileRepo.clearLocalDirty(entry.fileId);
          }
        }
      }

      if (needsUserInput.length > 0) {
        return {
          ...pullResult,
          conflicts: needsUserInput,
          direction: 'bidirectional',
        };
      }
    }

    const pushResult = await this.executePush(machineId, connectionInfo, openclawHome, triggeredBy);

    return {
      ...pushResult,
      direction: 'bidirectional',
      totalFiles: pullResult.totalFiles + pushResult.totalFiles,
      syncedFiles: pullResult.syncedFiles + pushResult.syncedFiles,
      failedFiles: pullResult.failedFiles + pushResult.failedFiles,
      errors: [...pullResult.errors, ...pushResult.errors],
    };
  }

  private estimateDuration(mode: string, fileCount: number): number {
    const baseMs = mode === 'hot' ? 3000 : mode === 'warm' ? 10_000 : 120_000;
    return baseMs + fileCount * 500;
  }
}
