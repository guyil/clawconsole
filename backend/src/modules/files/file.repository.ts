import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { getDb, type Knex } from '../../shared/db.js';
import { classifyFile, detectFileType, extractAgentId, type FileCategory, type FileType } from '../../shared/file-classifier.js';
import { classifyMemoryFile, type MemoryFileRecord } from '../../shared/memory-classifier.js';
import { hashContent } from '../../shared/crypto.js';
import type { ManagedFile, FileListFilters } from './file.types.js';
import type { LocalFileState } from '../sync/sync.types.js';
import type { FileRepositoryInterface } from '../sync/sync-engine.js';

export class FileRepository implements FileRepositoryInterface {
  private get db(): Knex {
    return getDb();
  }

  async findByMachineId(machineId: string): Promise<LocalFileState[]> {
    const rows = await this.db('managed_files')
      .where('machine_id', machineId)
      .select('id', 'relative_path', 'content_hash', 'remote_hash', 'local_dirty', 'content');

    return rows.map((row) => ({
      id: row.id,
      relativePath: row.relative_path,
      contentHash: row.content_hash,
      remoteHash: row.remote_hash,
      localDirty: Boolean(row.local_dirty),
      content: row.content,
    }));
  }

  async findById(id: string): Promise<ManagedFile | null> {
    const row = await this.db('managed_files').where('id', id).first();
    return row ? this.toManagedFile(row) : null;
  }

  async findByPath(machineId: string, relativePath: string): Promise<ManagedFile | null> {
    const row = await this.db('managed_files')
      .where({ machine_id: machineId, relative_path: relativePath })
      .first();
    return row ? this.toManagedFile(row) : null;
  }

  async listFiles(machineId: string, filters?: FileListFilters): Promise<ManagedFile[]> {
    let query = this.db('managed_files').where('machine_id', machineId);

    if (filters?.category) query = query.where('file_category', filters.category);
    if (filters?.type) query = query.where('file_type', filters.type);
    if (filters?.agentId) query = query.where('agent_id', filters.agentId);
    if (filters?.dirty !== undefined) query = query.where('local_dirty', filters.dirty);

    const rows = await query.orderBy('relative_path', 'asc');
    return rows.map(this.toManagedFile);
  }

  /**
   * Fetch .md config/persona files for a specific agent by workspace path prefix.
   * Used by the config-files endpoint to read from the DB cache instead of SSH.
   */
  async findConfigFilesByWorkspace(
    machineId: string,
    workspacePath: string,
  ): Promise<Array<{ filename: string; content: string; updatedAt: Date }>> {
    const rows = await this.db('managed_files')
      .where('machine_id', machineId)
      .where('relative_path', 'like', `${workspacePath}/%.md`)
      .whereNotNull('content')
      .select('relative_path', 'content', 'updated_at')
      .orderBy('relative_path', 'asc');

    return rows.map((row) => ({
      filename: (row.relative_path as string).replace(`${workspacePath}/`, ''),
      content: row.content as string,
      updatedAt: new Date(row.updated_at as string),
    }));
  }

  /**
   * Fetch memory files (.md only, no .sqlite) for a specific agent.
   * Returns files from both workspace root (MEMORY.md) and memory/ subdirectory.
   */
  async findMemoryFilesByAgent(
    machineId: string,
    workspacePath: string,
  ): Promise<MemoryFileRecord[]> {
    // Don't filter by file_type: MEMORY.md at workspace root is classified
    // as 'other' (not 'memory') by detectFileType, so match by path only.
    const rows = await this.db('managed_files')
      .where('machine_id', machineId)
      .whereNotNull('content')
      .where(function () {
        this.where('relative_path', 'like', `${workspacePath}/memory/%.md`)
          .orWhere('relative_path', `${workspacePath}/MEMORY.md`)
          .orWhere('relative_path', `${workspacePath}/memory.md`);
      })
      .select('id', 'relative_path', 'content', 'remote_mtime', 'remote_size', 'updated_at')
      .orderBy('remote_mtime', 'desc');

    return rows.map((row) => ({
      id: row.id as string,
      relativePath: row.relative_path as string,
      filename: path.basename(row.relative_path as string),
      content: row.content as string,
      category: classifyMemoryFile(row.relative_path as string),
      mtime: row.remote_mtime ? Number(row.remote_mtime) : null,
      size: row.remote_size ? Number(row.remote_size) : null,
      updatedAt: new Date(row.updated_at as string),
    }));
  }

  async upsertFile(params: {
    machineId: string;
    relativePath: string;
    content: string | null;
    contentHash: string | null;
    remoteHash: string | null;
    remoteMtime: number | null;
    remoteSize: number | null;
    localDirty: boolean;
    remoteDirty: boolean;
  }): Promise<string> {
    const existing = await this.findByPath(params.machineId, params.relativePath);

    const agentIdStr = extractAgentId(params.relativePath);
    let agentDbId: string | null = null;
    if (agentIdStr) {
      const agentRow = await this.db('agents')
        .where({ machine_id: params.machineId, agent_id: agentIdStr })
        .select('id')
        .first();
      agentDbId = agentRow?.id ?? null;
    }

    const category = classifyFile(params.relativePath);
    const fileType = detectFileType(params.relativePath);

    if (existing) {
      await this.db('managed_files').where('id', existing.id).update({
        content: params.content,
        content_hash: params.contentHash,
        remote_hash: params.remoteHash,
        remote_mtime: params.remoteMtime,
        remote_size: params.remoteSize,
        local_dirty: params.localDirty,
        remote_dirty: params.remoteDirty,
        agent_id: agentDbId,
        file_category: category,
        file_type: fileType,
        updated_at: new Date(),
      });
      return existing.id;
    }

    const id = uuidv4();
    await this.db('managed_files').insert({
      id,
      machine_id: params.machineId,
      agent_id: agentDbId,
      relative_path: params.relativePath,
      file_category: category,
      file_type: fileType,
      content: params.content,
      content_hash: params.contentHash,
      remote_hash: params.remoteHash,
      remote_mtime: params.remoteMtime,
      remote_size: params.remoteSize,
      local_dirty: params.localDirty,
      remote_dirty: params.remoteDirty,
      created_at: new Date(),
      updated_at: new Date(),
    });
    return id;
  }

  async updateContent(id: string, content: string): Promise<void> {
    const contentHash = hashContent(content);
    await this.db('managed_files').where('id', id).update({
      content,
      content_hash: contentHash,
      local_dirty: true,
      updated_at: new Date(),
    });
  }

  async clearLocalDirty(fileId: string): Promise<void> {
    await this.db('managed_files').where('id', fileId).update({
      local_dirty: false,
      updated_at: new Date(),
    });
  }

  async clearRemoteDirty(fileId: string): Promise<void> {
    await this.db('managed_files').where('id', fileId).update({
      remote_dirty: false,
      updated_at: new Date(),
    });
  }

  async setRemoteDirty(machineId: string, paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    await this.db('managed_files')
      .where('machine_id', machineId)
      .whereIn('relative_path', paths)
      .update({ remote_dirty: true, updated_at: new Date() });
  }

  async getDirtyFiles(machineId: string): Promise<LocalFileState[]> {
    const rows = await this.db('managed_files')
      .where({ machine_id: machineId, local_dirty: true })
      .select('id', 'relative_path', 'content_hash', 'remote_hash', 'local_dirty', 'content');

    return rows.map((row) => ({
      id: row.id,
      relativePath: row.relative_path,
      contentHash: row.content_hash,
      remoteHash: row.remote_hash,
      localDirty: Boolean(row.local_dirty),
      content: row.content,
    }));
  }

  private toManagedFile(row: Record<string, unknown>): ManagedFile {
    return {
      id: row.id as string,
      machineId: row.machine_id as string,
      agentId: row.agent_id as string | null,
      relativePath: row.relative_path as string,
      fileCategory: row.file_category as FileCategory,
      fileType: row.file_type as FileType,
      content: row.content as string | null,
      contentHash: row.content_hash as string | null,
      remoteHash: row.remote_hash as string | null,
      remoteMtime: row.remote_mtime ? Number(row.remote_mtime) : null,
      remoteSize: row.remote_size ? Number(row.remote_size) : null,
      localDirty: Boolean(row.local_dirty),
      remoteDirty: Boolean(row.remote_dirty),
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    };
  }
}
