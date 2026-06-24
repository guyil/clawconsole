import { getDb, type Knex } from '../../shared/db.js';
import type {
  SessionSummary,
  InsertSummaryInput,
  SummaryFilters,
  ActiveAgentInfo,
  SummaryPushConfigEntry,
} from './summary.types.js';
import type { SessionMessage } from '../monitoring/monitoring.types.js';

function toMysqlDate(value: Date | string | number): Date {
  return value instanceof Date ? value : new Date(value);
}

export class SummaryRepository {
  private get db(): Knex {
    return getDb();
  }

  // ─── Summaries ──────────────────────────────────────────────────────

  async insertSummary(input: InsertSummaryInput): Promise<number> {
    const [id] = await this.db('session_summaries').insert({
      machine_id: input.machineId,
      agent_id: input.agentId,
      agent_uuid: input.agentUuid,
      period_start_at: toMysqlDate(input.periodStartAt),
      period_end_at: toMysqlDate(input.periodEndAt),
      session_count: input.sessionCount,
      message_count: input.messageCount,
      input_tokens: input.inputTokens,
      output_tokens: input.outputTokens,
      total_tokens: input.totalTokens,
      model: input.model,
      summary_markdown: input.summaryMarkdown,
      trigger: input.trigger,
      status: input.status,
      error_message: input.errorMessage ?? null,
      feishu_pushed: input.feishuPushed ?? false,
      feishu_push_error: input.feishuPushError ?? null,
    });
    return Number(id);
  }

  async updateFeishuStatus(
    id: number,
    opts: { pushed: boolean; error: string | null },
  ): Promise<void> {
    await this.db('session_summaries').where('id', id).update({
      feishu_pushed: opts.pushed,
      feishu_push_error: opts.error,
    });
  }

  async findById(id: number): Promise<SessionSummary | null> {
    const row = await this.db('session_summaries').where('id', id).first();
    return row ? this.toSummary(row) : null;
  }

  async listSummaries(filters: SummaryFilters): Promise<SessionSummary[]> {
    const limit = Math.min(filters.limit ?? 50, 500);
    const offset = filters.offset ?? 0;

    let query = this.db('session_summaries').select('*');

    if (filters.machineId) query = query.where('machine_id', filters.machineId);
    if (filters.agentId) query = query.where('agent_id', filters.agentId);
    if (filters.agentUuid) query = query.where('agent_uuid', filters.agentUuid);
    if (filters.trigger) query = query.where('trigger', filters.trigger);
    if (filters.status) query = query.where('status', filters.status);
    if (filters.since) query = query.where('period_end_at', '>=', toMysqlDate(filters.since));
    if (filters.until) query = query.where('period_end_at', '<=', toMysqlDate(filters.until));
    if (filters.allowedAgentUuids !== undefined) {
      query = filters.allowedAgentUuids.length
        ? query.whereIn('agent_uuid', filters.allowedAgentUuids)
        : query.whereRaw('1 = 0');
    }

    const rows = await query.orderBy('period_end_at', 'desc').limit(limit).offset(offset);
    return rows.map(this.toSummary);
  }

  async countSummaries(filters: Omit<SummaryFilters, 'limit' | 'offset'>): Promise<number> {
    let query = this.db('session_summaries').count('* as cnt');
    if (filters.machineId) query = query.where('machine_id', filters.machineId);
    if (filters.agentId) query = query.where('agent_id', filters.agentId);
    if (filters.agentUuid) query = query.where('agent_uuid', filters.agentUuid);
    if (filters.trigger) query = query.where('trigger', filters.trigger);
    if (filters.status) query = query.where('status', filters.status);
    if (filters.since) query = query.where('period_end_at', '>=', toMysqlDate(filters.since));
    if (filters.until) query = query.where('period_end_at', '<=', toMysqlDate(filters.until));
    if (filters.allowedAgentUuids !== undefined) {
      query = filters.allowedAgentUuids.length
        ? query.whereIn('agent_uuid', filters.allowedAgentUuids)
        : query.whereRaw('1 = 0');
    }
    const result = await query.first();
    return Number(result?.cnt ?? 0);
  }

  // ─── Active agents in window ────────────────────────────────────────

  /**
   * Returns every (machine_id, agent_id) pair that received at least one
   * session message with message_timestamp falling inside [from, to].
   *
   * Note: session_messages.message_timestamp is stored as a millisecond
   * bigint (OpenClaw's transcript line format), hence the comparison with
   * epoch ms rather than a SQL timestamp.
   */
  async findActiveAgentsInWindow(from: Date, to: Date): Promise<ActiveAgentInfo[]> {
    const fromMs = from.getTime();
    const toMs = to.getTime();

    const rows = await this.db('session_messages')
      .select('machine_id', 'agent_id')
      .count('* as msg_count')
      .whereBetween('message_timestamp', [fromMs, toMs])
      .groupBy('machine_id', 'agent_id');

    return rows.map((r) => ({
      machineId: r.machine_id as string,
      agentId: r.agent_id as string,
      messageCount: Number(r.msg_count),
    }));
  }

  /**
   * Fetch all session messages for one bot in the window, ordered by
   * (session_id, message_index) so the caller can group them into
   * coherent transcripts.
   */
  async findMessagesInWindow(
    machineId: string,
    agentId: string,
    from: Date,
    to: Date,
  ): Promise<SessionMessage[]> {
    const rows = await this.db('session_messages')
      .where({ machine_id: machineId, agent_id: agentId })
      .whereBetween('message_timestamp', [from.getTime(), to.getTime()])
      .orderBy('session_id', 'asc')
      .orderBy('message_index', 'asc');

    return rows.map((row) => ({
      id: Number(row.id),
      machineId: row.machine_id as string,
      agentId: row.agent_id as string,
      sessionId: row.session_id as string,
      messageIndex: Number(row.message_index),
      role: row.role as SessionMessage['role'],
      content: row.content as string | null,
      provider: row.provider as string | null,
      model: row.model as string | null,
      api: row.api as string | null,
      stopReason: row.stop_reason as string | null,
      inputTokens: row.input_tokens != null ? Number(row.input_tokens) : null,
      outputTokens: row.output_tokens != null ? Number(row.output_tokens) : null,
      cacheReadTokens: row.cache_read_tokens != null ? Number(row.cache_read_tokens) : null,
      cacheWriteTokens: row.cache_write_tokens != null ? Number(row.cache_write_tokens) : null,
      totalTokens: row.total_tokens != null ? Number(row.total_tokens) : null,
      costUsd: row.cost_usd != null ? Number(row.cost_usd) : null,
      messageTimestamp: row.message_timestamp != null ? Number(row.message_timestamp) : null,
      collectedAt: row.collected_at as string,
    }));
  }

  // ─── Push config (summary_push_enabled on agents) ───────────────────

  async setPushEnabled(agentUuid: string, enabled: boolean): Promise<boolean> {
    const updated = await this.db('agents')
      .where('id', agentUuid)
      .update({ summary_push_enabled: enabled, updated_at: new Date() });
    return updated > 0;
  }

  async listPushConfig(): Promise<SummaryPushConfigEntry[]> {
    const rows = await this.db('agents')
      .join('machines', 'agents.machine_id', 'machines.id')
      .select(
        'agents.id as agent_uuid',
        'agents.machine_id',
        'agents.agent_id',
        'agents.name as agent_name',
        'machines.name as machine_name',
        'agents.summary_push_enabled',
      )
      .orderBy('machines.name', 'asc')
      .orderBy('agents.is_default', 'desc')
      .orderBy('agents.agent_id', 'asc');

    return rows.map((r: Record<string, unknown>) => ({
      agentUuid: r.agent_uuid as string,
      machineId: r.machine_id as string,
      agentId: r.agent_id as string,
      agentName: (r.agent_name as string | null) ?? null,
      machineName: r.machine_name as string,
      enabled: Boolean(r.summary_push_enabled),
    }));
  }

  async isPushEnabled(machineId: string, agentId: string): Promise<boolean> {
    const row = await this.db('agents')
      .where({ machine_id: machineId, agent_id: agentId })
      .select('summary_push_enabled')
      .first();
    return Boolean(row?.summary_push_enabled);
  }

  // ─── Row mapper ─────────────────────────────────────────────────────

  private toSummary(row: Record<string, unknown>): SessionSummary {
    return {
      id: Number(row.id),
      machineId: row.machine_id as string,
      agentId: row.agent_id as string,
      agentUuid: (row.agent_uuid as string | null) ?? null,
      periodStartAt: row.period_start_at instanceof Date
        ? (row.period_start_at as Date).toISOString()
        : (row.period_start_at as string),
      periodEndAt: row.period_end_at instanceof Date
        ? (row.period_end_at as Date).toISOString()
        : (row.period_end_at as string),
      sessionCount: Number(row.session_count ?? 0),
      messageCount: Number(row.message_count ?? 0),
      inputTokens: Number(row.input_tokens ?? 0),
      outputTokens: Number(row.output_tokens ?? 0),
      totalTokens: Number(row.total_tokens ?? 0),
      model: (row.model as string | null) ?? null,
      summaryMarkdown: (row.summary_markdown as string | null) ?? null,
      trigger: row.trigger as SessionSummary['trigger'],
      status: row.status as SessionSummary['status'],
      errorMessage: (row.error_message as string | null) ?? null,
      feishuPushed: Boolean(row.feishu_pushed),
      feishuPushError: (row.feishu_push_error as string | null) ?? null,
      createdAt: row.created_at instanceof Date
        ? (row.created_at as Date).toISOString()
        : (row.created_at as string),
    };
  }
}
