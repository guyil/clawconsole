import { getDb, type Knex } from '../../shared/db.js';
import type { SyncOperationStatus, SyncOperationRecord } from './sync.types.js';
import type { SyncRepositoryInterface } from './sync-engine.js';

export class SyncRepository implements SyncRepositoryInterface {
  private get db(): Knex {
    return getDb();
  }

  async createOperation(params: {
    id: string;
    machineId: string;
    syncType: string;
    syncDirection: string;
    triggeredBy: string;
    totalFiles: number;
    requiresRestart: boolean;
  }): Promise<void> {
    await this.db('sync_operations').insert({
      id: params.id,
      machine_id: params.machineId,
      sync_type: params.syncType,
      sync_direction: params.syncDirection,
      status: 'in_progress',
      triggered_by: params.triggeredBy,
      total_files: params.totalFiles,
      requires_restart: params.requiresRestart,
      started_at: new Date(),
      created_at: new Date(),
    });
  }

  async updateOperationStatus(params: {
    id: string;
    status: SyncOperationStatus;
    syncedFiles: number;
    failedFiles: number;
    errorMessage: string | null;
    completedAt: Date | null;
    durationMs: number | null;
    restartPerformed: boolean;
  }): Promise<void> {
    await this.db('sync_operations').where('id', params.id).update({
      status: params.status,
      synced_files: params.syncedFiles,
      failed_files: params.failedFiles,
      error_message: params.errorMessage,
      completed_at: params.completedAt,
      duration_ms: params.durationMs,
      restart_performed: params.restartPerformed,
    });
  }

  async createOperationFile(params: {
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
  }): Promise<void> {
    await this.db('sync_operation_files').insert({
      id: params.id,
      sync_operation_id: params.syncOperationId,
      managed_file_id: params.managedFileId,
      relative_path: params.relativePath,
      action: params.action,
      status: params.status,
      before_hash: params.beforeHash,
      after_hash: params.afterHash,
      file_size_bytes: params.fileSizeBytes,
      error_message: params.errorMessage,
      created_at: new Date(),
    });
  }

  async findOperationById(id: string): Promise<SyncOperationRecord | null> {
    const row = await this.db('sync_operations').where('id', id).first();
    return row ? this.toRecord(row) : null;
  }

  async findOperationsByMachine(
    machineId: string,
    options?: { status?: SyncOperationStatus; limit?: number; offset?: number },
  ): Promise<SyncOperationRecord[]> {
    let query = this.db('sync_operations')
      .where('machine_id', machineId)
      .orderBy('created_at', 'desc');

    if (options?.status) query = query.where('status', options.status);
    if (options?.limit) query = query.limit(options.limit);
    if (options?.offset) query = query.offset(options.offset);

    const rows = await query;
    return rows.map(this.toRecord);
  }

  async findRetryableOperations(): Promise<SyncOperationRecord[]> {
    const rows = await this.db('sync_operations')
      .whereIn('status', ['partial_failure', 'failed'])
      .where('retry_count', '<', 3)
      .orderBy('created_at', 'asc')
      .limit(10);

    return rows.map(this.toRecord);
  }

  async incrementRetryCount(id: string): Promise<void> {
    await this.db('sync_operations').where('id', id).increment('retry_count', 1);
  }

  async getOperationFiles(operationId: string): Promise<Array<{
    id: string;
    relativePath: string;
    action: string;
    status: string;
    beforeHash: string | null;
    afterHash: string | null;
    errorMessage: string | null;
  }>> {
    return this.db('sync_operation_files')
      .where('sync_operation_id', operationId)
      .select('id', 'relative_path as relativePath', 'action', 'status', 'before_hash as beforeHash', 'after_hash as afterHash', 'error_message as errorMessage')
      .orderBy('relative_path', 'asc');
  }

  private toRecord(row: Record<string, unknown>): SyncOperationRecord {
    return {
      id: row.id as string,
      machineId: row.machine_id as string,
      syncType: row.sync_type as SyncOperationRecord['syncType'],
      syncDirection: row.sync_direction as SyncOperationRecord['syncDirection'],
      status: row.status as SyncOperationStatus,
      triggeredBy: row.triggered_by as string | null,
      totalFiles: row.total_files as number,
      syncedFiles: row.synced_files as number,
      failedFiles: row.failed_files as number,
      errorMessage: row.error_message as string | null,
      startedAt: row.started_at ? new Date(row.started_at as string) : null,
      completedAt: row.completed_at ? new Date(row.completed_at as string) : null,
      durationMs: row.duration_ms as number | null,
      requiresRestart: Boolean(row.requires_restart),
      restartPerformed: Boolean(row.restart_performed),
      retryCount: row.retry_count as number,
      parentOperationId: row.parent_operation_id as string | null,
      createdAt: new Date(row.created_at as string),
    };
  }
}
