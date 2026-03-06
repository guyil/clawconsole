import { v4 as uuidv4 } from 'uuid';
import { getDb, type Knex } from '../../shared/db.js';
import type {
  AssistantSession,
  AssistantMessage,
  AssistantToolCallEntry,
} from './assistant.types.js';

export class AssistantRepository {
  private get db(): Knex {
    return getDb();
  }

  async createSession(title?: string): Promise<AssistantSession> {
    const id = uuidv4();
    const now = new Date();

    await this.db('assistant_sessions').insert({
      id,
      title: title ?? null,
      messages: JSON.stringify([]),
      tool_calls_log: JSON.stringify([]),
      created_at: now,
      updated_at: now,
    });

    return (await this.findById(id))!;
  }

  async findById(id: string): Promise<AssistantSession | null> {
    const row = await this.db('assistant_sessions').where('id', id).first();
    return row ? this.toSession(row) : null;
  }

  async findAll(): Promise<AssistantSession[]> {
    const rows = await this.db('assistant_sessions')
      .select('*')
      .orderBy('updated_at', 'desc');
    return rows.map((row) => this.toSession(row));
  }

  async updateTitle(id: string, title: string): Promise<void> {
    await this.db('assistant_sessions')
      .where('id', id)
      .update({ title, updated_at: new Date() });
  }

  async appendMessage(id: string, message: AssistantMessage): Promise<void> {
    await this.db.raw(
      `UPDATE assistant_sessions SET messages = JSON_ARRAY_APPEND(messages, '$', CAST(? AS JSON)), updated_at = ? WHERE id = ?`,
      [JSON.stringify(message), new Date(), id],
    );
  }

  async appendToolCallLog(id: string, entry: AssistantToolCallEntry): Promise<void> {
    await this.db.raw(
      `UPDATE assistant_sessions SET tool_calls_log = JSON_ARRAY_APPEND(tool_calls_log, '$', CAST(? AS JSON)), updated_at = ? WHERE id = ?`,
      [JSON.stringify(entry), new Date(), id],
    );
  }

  async deleteSession(id: string): Promise<boolean> {
    const deleted = await this.db('assistant_sessions').where('id', id).delete();
    return deleted > 0;
  }

  /** MySQL JSON columns may return already-parsed objects or raw strings. */
  private safeJsonParse<T>(value: unknown, fallback: T): T {
    if (value == null) return fallback;
    if (typeof value === 'object') return value as T;
    if (typeof value === 'string') {
      try { return JSON.parse(value) as T; } catch { return fallback; }
    }
    return fallback;
  }

  private toSession(row: Record<string, unknown>): AssistantSession {
    return {
      id: row.id as string,
      title: row.title as string | null,
      messages: this.safeJsonParse<AssistantMessage[]>(row.messages, []),
      toolCallsLog: this.safeJsonParse<AssistantToolCallEntry[]>(row.tool_calls_log, []),
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    };
  }
}
