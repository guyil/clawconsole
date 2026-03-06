import { v4 as uuidv4 } from 'uuid';
import { getDb, type Knex } from '../../shared/db.js';
import type {
  PlaygroundSession,
  PlaygroundSessionConfig,
  PlaygroundSessionStatus,
  PlaygroundMessage,
  ToolCallLogEntry,
  SecurityScanResult,
  SkillVersion,
  CreateSkillVersionInput,
  BotIdentityFile,
  SkillFileMap,
} from './playground.types.js';

export class PlaygroundRepository {
  private get db(): Knex {
    return getDb();
  }

  // --- Playground Sessions ---

  async createSession(
    skillCatalogId: string | null,
    skillSnapshot: string,
    config: PlaygroundSessionConfig,
    agentId?: string | null,
    identityFiles?: BotIdentityFile[] | null,
  ): Promise<PlaygroundSession> {
    const id = uuidv4();
    const now = new Date();

    await this.db('playground_sessions').insert({
      id,
      skill_catalog_id: skillCatalogId,
      agent_id: agentId ?? null,
      skill_snapshot: skillSnapshot,
      identity_snapshot: identityFiles ? JSON.stringify(identityFiles) : null,
      skill_files: JSON.stringify({ 'SKILL.md': skillSnapshot }),
      config: JSON.stringify(config),
      status: 'active',
      messages: JSON.stringify([]),
      tool_calls_log: JSON.stringify([]),
      optimizer_messages: JSON.stringify([]),
      security_scan_result: null,
      error_info: null,
      started_at: now,
      completed_at: null,
      created_at: now,
    });

    return (await this.findSessionById(id))!;
  }

  async findSessionById(id: string): Promise<PlaygroundSession | null> {
    const row = await this.db('playground_sessions').where('id', id).first();
    return row ? this.toSession(row) : null;
  }

  async listSessions(filters?: {
    status?: PlaygroundSessionStatus;
    skillCatalogId?: string;
  }): Promise<PlaygroundSession[]> {
    let query = this.db('playground_sessions').select('*');
    if (filters?.status) query = query.where('status', filters.status);
    if (filters?.skillCatalogId) query = query.where('skill_catalog_id', filters.skillCatalogId);
    const rows = await query.orderBy('created_at', 'desc');
    return rows.map((row) => this.toSession(row));
  }

  async updateSessionStatus(id: string, status: PlaygroundSessionStatus, errorInfo?: Record<string, unknown>): Promise<void> {
    const updates: Record<string, unknown> = { status };
    if (status === 'completed' || status === 'error' || status === 'timeout') {
      updates.completed_at = new Date();
    }
    if (errorInfo) {
      updates.error_info = JSON.stringify(errorInfo);
    }
    await this.db('playground_sessions').where('id', id).update(updates);
  }

  async appendMessage(id: string, message: PlaygroundMessage): Promise<void> {
    await this.db.raw(
      `UPDATE playground_sessions SET messages = JSON_ARRAY_APPEND(messages, '$', CAST(? AS JSON)) WHERE id = ?`,
      [JSON.stringify(message), id],
    );
  }

  async appendToolCallLog(id: string, entry: ToolCallLogEntry): Promise<void> {
    await this.db.raw(
      `UPDATE playground_sessions SET tool_calls_log = JSON_ARRAY_APPEND(tool_calls_log, '$', CAST(? AS JSON)) WHERE id = ?`,
      [JSON.stringify(entry), id],
    );
  }

  async setSecurityScanResult(id: string, result: SecurityScanResult): Promise<void> {
    await this.db('playground_sessions')
      .where('id', id)
      .update({ security_scan_result: JSON.stringify(result) });
  }

  async deleteSession(id: string): Promise<boolean> {
    const deleted = await this.db('playground_sessions').where('id', id).delete();
    return deleted > 0;
  }

  // --- Skill Files ---

  async getSkillFiles(id: string): Promise<SkillFileMap> {
    const row = await this.db('playground_sessions').where('id', id).select('skill_files').first();
    return row ? this.safeJsonParse<SkillFileMap>(row.skill_files, {}) : {};
  }

  async setSkillFiles(id: string, files: SkillFileMap): Promise<void> {
    await this.db('playground_sessions')
      .where('id', id)
      .update({ skill_files: JSON.stringify(files) });
  }

  async updateSkillFile(id: string, filePath: string, content: string): Promise<void> {
    const files = await this.getSkillFiles(id);
    files[filePath] = content;
    await this.setSkillFiles(id, files);
    if (filePath === 'SKILL.md') {
      await this.db('playground_sessions').where('id', id).update({ skill_snapshot: content });
    }
  }

  async deleteSkillFile(id: string, filePath: string): Promise<void> {
    const files = await this.getSkillFiles(id);
    delete files[filePath];
    await this.setSkillFiles(id, files);
  }

  // --- Optimizer Messages ---

  async appendOptimizerMessage(id: string, message: PlaygroundMessage): Promise<void> {
    await this.db.raw(
      `UPDATE playground_sessions SET optimizer_messages = JSON_ARRAY_APPEND(COALESCE(optimizer_messages, JSON_ARRAY()), '$', CAST(? AS JSON)) WHERE id = ?`,
      [JSON.stringify(message), id],
    );
  }

  // --- Skill Versions ---

  async createVersion(skillCatalogId: string, input: CreateSkillVersionInput): Promise<SkillVersion> {
    const id = uuidv4();
    const now = new Date();

    await this.db('skill_versions').insert({
      id,
      skill_catalog_id: skillCatalogId,
      version: input.version,
      skill_md_content: input.skillMdContent,
      frontmatter: input.frontmatter ? JSON.stringify(input.frontmatter) : null,
      auxiliary_files: input.auxiliaryFiles ? JSON.stringify(input.auxiliaryFiles) : null,
      change_note: input.changeNote ?? null,
      created_at: now,
    });

    return (await this.findVersionById(id))!;
  }

  async findVersionById(id: string): Promise<SkillVersion | null> {
    const row = await this.db('skill_versions').where('id', id).first();
    return row ? this.toVersion(row) : null;
  }

  async listVersions(skillCatalogId: string): Promise<SkillVersion[]> {
    const rows = await this.db('skill_versions')
      .where('skill_catalog_id', skillCatalogId)
      .orderBy('created_at', 'desc');
    return rows.map((row) => this.toVersion(row));
  }

  async findVersionByNumber(skillCatalogId: string, version: string): Promise<SkillVersion | null> {
    const row = await this.db('skill_versions')
      .where({ skill_catalog_id: skillCatalogId, version })
      .first();
    return row ? this.toVersion(row) : null;
  }

  // --- Mappers ---

  /** MySQL JSON columns may return already-parsed objects or raw strings. */
  private safeJsonParse<T>(value: unknown, fallback: T): T {
    if (value == null) return fallback;
    if (typeof value === 'object') return value as T;
    if (typeof value === 'string') {
      try { return JSON.parse(value) as T; } catch { return fallback; }
    }
    return fallback;
  }

  private toSession(row: Record<string, unknown>): PlaygroundSession {
    return {
      id: row.id as string,
      skillCatalogId: row.skill_catalog_id as string | null,
      agentId: (row.agent_id as string | null) ?? null,
      skillSnapshot: row.skill_snapshot as string,
      identitySnapshot: this.safeJsonParse<BotIdentityFile[] | null>(row.identity_snapshot, null),
      skillFiles: this.safeJsonParse<SkillFileMap>(row.skill_files, {}),
      optimizerMessages: this.safeJsonParse<PlaygroundMessage[]>(row.optimizer_messages, []),
      config: this.safeJsonParse(row.config, {} as PlaygroundSessionConfig),
      status: row.status as PlaygroundSessionStatus,
      messages: this.safeJsonParse(row.messages, []),
      toolCallsLog: this.safeJsonParse(row.tool_calls_log, []),
      securityScanResult: this.safeJsonParse(row.security_scan_result, null),
      errorInfo: this.safeJsonParse(row.error_info, null),
      startedAt: new Date(row.started_at as string),
      completedAt: row.completed_at ? new Date(row.completed_at as string) : null,
      createdAt: new Date(row.created_at as string),
    };
  }

  private toVersion(row: Record<string, unknown>): SkillVersion {
    return {
      id: row.id as string,
      skillCatalogId: row.skill_catalog_id as string,
      version: row.version as string,
      skillMdContent: row.skill_md_content as string,
      frontmatter: this.safeJsonParse(row.frontmatter, null),
      auxiliaryFiles: this.safeJsonParse(row.auxiliary_files, null),
      changeNote: row.change_note as string | null,
      createdAt: new Date(row.created_at as string),
    };
  }
}
