import { getDb, type Knex } from '../../shared/db.js';

/** Convert an ISO 8601 string or Date to a MySQL-compatible Date object. */
function toMysqlDate(value: string | Date | number): Date {
  return value instanceof Date ? value : new Date(value);
}

import type {
  SessionSnapshot,
  UpsertSessionSnapshotInput,
  SessionMessage,
  InsertSessionMessageInput,
  GatewayLog,
  InsertGatewayLogInput,
  DiagnosticEvent,
  InsertDiagnosticEventInput,
  SessionSnapshotFilters,
  SessionMessageFilters,
  GatewayLogFilters,
  DiagnosticEventFilters,
  AgentUsageSummary,
  UsageSummary,
} from './monitoring.types.js';

export class MonitoringRepository {
  private get db(): Knex {
    return getDb();
  }

  // ─── Session Snapshots ───────────────────────────────────────────

  async upsertSessionSnapshot(input: UpsertSessionSnapshotInput): Promise<void> {
    const row = {
      machine_id: input.machineId,
      agent_id: input.agentId,
      session_key: input.sessionKey,
      session_id: input.sessionId ?? null,
      channel: input.channel ?? null,
      chat_type: input.chatType ?? null,
      origin_from: input.originFrom ?? null,
      origin_to: input.originTo ?? null,
      origin_provider: input.originProvider ?? null,
      origin_surface: input.originSurface ?? null,
      model_provider: input.modelProvider ?? null,
      model: input.model ?? null,
      thinking_level: input.thinkingLevel ?? null,
      input_tokens: input.inputTokens ?? 0,
      output_tokens: input.outputTokens ?? 0,
      total_tokens: input.totalTokens ?? 0,
      cache_read: input.cacheRead ?? 0,
      cache_write: input.cacheWrite ?? 0,
      label: input.label ?? null,
      display_name: input.displayName ?? null,
      send_policy: input.sendPolicy ?? null,
      compaction_count: input.compactionCount ?? 0,
      last_activity_at: input.lastActivityAt ? toMysqlDate(input.lastActivityAt) : null,
      snapshot_at: this.db.fn.now(),
    };

    await this.db('session_snapshots')
      .insert(row)
      .onConflict(['machine_id', 'agent_id', 'session_key'])
      .merge({
        ...row,
        machine_id: undefined,
        agent_id: undefined,
        session_key: undefined,
      });
  }

  async upsertSessionSnapshots(inputs: UpsertSessionSnapshotInput[]): Promise<void> {
    for (const input of inputs) {
      await this.upsertSessionSnapshot(input);
    }
  }

  async findSessionSnapshots(filters: SessionSnapshotFilters): Promise<SessionSnapshot[]> {
    const limit = Math.min(filters.limit ?? 50, 500);
    const offset = filters.offset ?? 0;

    let query = this.db('session_snapshots').select('*');

    if (filters.machineId) {
      query = query.where('machine_id', filters.machineId);
    }
    if (filters.agentId) {
      query = query.where('agent_id', filters.agentId);
    }
    if (filters.channel) {
      query = query.where('channel', filters.channel);
    }
    if (filters.activeMinutes) {
      const cutoff = new Date(Date.now() - filters.activeMinutes * 60_000);
      query = query.where('last_activity_at', '>=', cutoff);
    }

    const rows = await query.orderBy('last_activity_at', 'desc').limit(limit).offset(offset);
    return rows.map(this.toSessionSnapshot);
  }

  async findSessionSnapshotByKey(machineId: string, sessionKey: string): Promise<SessionSnapshot | null> {
    const row = await this.db('session_snapshots')
      .where({ machine_id: machineId, session_key: sessionKey })
      .first();
    return row ? this.toSessionSnapshot(row) : null;
  }

  async countSessionSnapshots(filters: { machineId?: string; agentId?: string; activeMinutes?: number }): Promise<number> {
    let query = this.db('session_snapshots').count('* as cnt');
    if (filters.machineId) {
      query = query.where('machine_id', filters.machineId);
    }
    if (filters.agentId) {
      query = query.where('agent_id', filters.agentId);
    }
    if (filters.activeMinutes) {
      const cutoff = new Date(Date.now() - filters.activeMinutes * 60_000);
      query = query.where('last_activity_at', '>=', cutoff);
    }
    const result = await query.first();
    return Number(result?.cnt ?? 0);
  }

  async getAgentUsageSummaries(machineId?: string): Promise<AgentUsageSummary[]> {
    let query = this.db('session_snapshots')
      .select(
        'agent_id',
        'machine_id',
        this.db.raw('COUNT(*) as session_count'),
        this.db.raw('COALESCE(SUM(input_tokens), 0) as total_input_tokens'),
        this.db.raw('COALESCE(SUM(output_tokens), 0) as total_output_tokens'),
        this.db.raw('COALESCE(SUM(total_tokens), 0) as total_tokens'),
        this.db.raw('MAX(last_activity_at) as last_activity_at'),
      )
      .groupBy('agent_id', 'machine_id');

    if (machineId) {
      query = query.where('machine_id', machineId);
    }

    const rows = await query;
    return rows.map((r: Record<string, unknown>) => ({
      agentId: r.agent_id as string,
      machineId: r.machine_id as string,
      sessionCount: Number(r.session_count),
      totalInputTokens: Number(r.total_input_tokens),
      totalOutputTokens: Number(r.total_output_tokens),
      totalTokens: Number(r.total_tokens),
      lastActivityAt: r.last_activity_at as string | null,
    }));
  }

  async getUsageSummary(filters: { machineId?: string; agentId?: string }): Promise<UsageSummary[]> {
    let query = this.db('session_snapshots')
      .select(
        'agent_id',
        'machine_id',
        this.db.raw('COALESCE(SUM(input_tokens), 0) as total_input_tokens'),
        this.db.raw('COALESCE(SUM(output_tokens), 0) as total_output_tokens'),
        this.db.raw('COALESCE(SUM(total_tokens), 0) as total_tokens'),
        this.db.raw('COALESCE(SUM(cache_read), 0) as total_cache_read'),
        this.db.raw('COALESCE(SUM(cache_write), 0) as total_cache_write'),
        this.db.raw('COUNT(*) as session_count'),
      )
      .groupBy('agent_id', 'machine_id');

    if (filters.machineId) {
      query = query.where('machine_id', filters.machineId);
    }
    if (filters.agentId) {
      query = query.where('agent_id', filters.agentId);
    }

    const rows = await query;
    return rows.map((r: Record<string, unknown>) => ({
      agentId: r.agent_id as string,
      machineId: r.machine_id as string,
      totalInputTokens: Number(r.total_input_tokens),
      totalOutputTokens: Number(r.total_output_tokens),
      totalTokens: Number(r.total_tokens),
      totalCacheRead: Number(r.total_cache_read),
      totalCacheWrite: Number(r.total_cache_write),
      sessionCount: Number(r.session_count),
    }));
  }

  // ─── Session Messages ────────────────────────────────────────────

  async insertSessionMessages(inputs: InsertSessionMessageInput[]): Promise<void> {
    if (inputs.length === 0) return;

    const rows = inputs.map((m) => ({
      machine_id: m.machineId,
      agent_id: m.agentId,
      session_id: m.sessionId,
      message_index: m.messageIndex,
      role: m.role,
      content: m.content ?? null,
      provider: m.provider ?? null,
      model: m.model ?? null,
      api: m.api ?? null,
      stop_reason: m.stopReason ?? null,
      input_tokens: m.inputTokens ?? null,
      output_tokens: m.outputTokens ?? null,
      cache_read_tokens: m.cacheReadTokens ?? null,
      cache_write_tokens: m.cacheWriteTokens ?? null,
      total_tokens: m.totalTokens ?? null,
      cost_usd: m.costUsd ?? null,
      message_timestamp: m.messageTimestamp ?? null,
    }));

    // Batch insert, skip duplicates
    for (const row of rows) {
      await this.db('session_messages')
        .insert(row)
        .onConflict(['machine_id', 'session_id', 'message_index'])
        .ignore();
    }
  }

  async findSessionMessages(filters: SessionMessageFilters): Promise<SessionMessage[]> {
    const limit = Math.min(filters.limit ?? 100, 1000);
    const offset = filters.offset ?? 0;

    let query = this.db('session_messages')
      .where('machine_id', filters.machineId)
      .where('session_id', filters.sessionId);

    if (filters.agentId) {
      query = query.where('agent_id', filters.agentId);
    }

    const rows = await query.orderBy('message_index', 'asc').limit(limit).offset(offset);
    return rows.map(this.toSessionMessage);
  }

  async countSessionMessages(machineId: string, sessionId: string): Promise<number> {
    const result = await this.db('session_messages')
      .where({ machine_id: machineId, session_id: sessionId })
      .count('* as cnt')
      .first();
    return Number(result?.cnt ?? 0);
  }

  async getMaxMessageIndex(machineId: string, sessionId: string): Promise<number> {
    const result = await this.db('session_messages')
      .where({ machine_id: machineId, session_id: sessionId })
      .max('message_index as max_idx')
      .first();
    return Number(result?.max_idx ?? -1);
  }

  // ─── Gateway Logs ────────────────────────────────────────────────

  async insertGatewayLogs(inputs: InsertGatewayLogInput[]): Promise<void> {
    if (inputs.length === 0) return;

    const rows = inputs.map((l) => ({
      machine_id: l.machineId,
      log_source: l.logSource,
      level: l.level ?? null,
      subsystem: l.subsystem ?? null,
      message: l.message ?? null,
      session_key: l.sessionKey ?? null,
      session_id: l.sessionId ?? null,
      agent_id: l.agentId ?? null,
      channel: l.channel ?? null,
      extra_data: l.extraData ? JSON.stringify(l.extraData) : null,
      logged_at: toMysqlDate(l.loggedAt),
    }));

    // Batch insert in chunks of 100
    for (let i = 0; i < rows.length; i += 100) {
      const chunk = rows.slice(i, i + 100);
      await this.db('gateway_logs').insert(chunk);
    }
  }

  async findGatewayLogs(filters: GatewayLogFilters): Promise<GatewayLog[]> {
    const limit = Math.min(filters.limit ?? 100, 1000);
    const offset = filters.offset ?? 0;

    let query = this.db('gateway_logs').select('*');

    if (filters.machineId) {
      query = query.where('machine_id', filters.machineId);
    }
    if (filters.logSource) {
      query = query.where('log_source', filters.logSource);
    }
    if (filters.level) {
      query = query.where('level', filters.level);
    }
    if (filters.sessionKey) {
      query = query.where('session_key', filters.sessionKey);
    }
    if (filters.agentId) {
      query = query.where('agent_id', filters.agentId);
    }
    if (filters.since) {
      query = query.where('logged_at', '>=', filters.since);
    }
    if (filters.query) {
      query = query.where('message', 'like', `%${filters.query}%`);
    }

    const rows = await query.orderBy('logged_at', 'desc').limit(limit).offset(offset);
    return rows.map(this.toGatewayLog);
  }

  async countGatewayLogs(filters: { machineId?: string; logSource?: string; level?: string }): Promise<number> {
    let query = this.db('gateway_logs').count('* as cnt');
    if (filters.machineId) query = query.where('machine_id', filters.machineId);
    if (filters.logSource) query = query.where('log_source', filters.logSource);
    if (filters.level) query = query.where('level', filters.level);
    const result = await query.first();
    return Number(result?.cnt ?? 0);
  }

  async getLatestLogTimestamp(machineId: string, logSource: string): Promise<string | null> {
    const row = await this.db('gateway_logs')
      .where({ machine_id: machineId, log_source: logSource })
      .orderBy('logged_at', 'desc')
      .select('logged_at')
      .first();
    if (!row?.logged_at) return null;
    const val = row.logged_at;
    return val instanceof Date ? val.toISOString() : String(val);
  }

  // ─── Diagnostic Events ──────────────────────────────────────────

  async insertDiagnosticEvents(inputs: InsertDiagnosticEventInput[]): Promise<void> {
    if (inputs.length === 0) return;

    const rows = inputs.map((e) => ({
      machine_id: e.machineId,
      event_type: e.eventType,
      session_key: e.sessionKey ?? null,
      session_id: e.sessionId ?? null,
      channel: e.channel ?? null,
      provider: e.provider ?? null,
      model: e.model ?? null,
      duration_ms: e.durationMs ?? null,
      outcome: e.outcome ?? null,
      error_message: e.errorMessage ?? null,
      token_usage: e.tokenUsage ? JSON.stringify(e.tokenUsage) : null,
      extra_data: e.extraData ? JSON.stringify(e.extraData) : null,
      event_at: toMysqlDate(e.eventAt),
    }));

    for (let i = 0; i < rows.length; i += 100) {
      const chunk = rows.slice(i, i + 100);
      await this.db('diagnostic_events').insert(chunk);
    }
  }

  async findDiagnosticEvents(filters: DiagnosticEventFilters): Promise<DiagnosticEvent[]> {
    const limit = Math.min(filters.limit ?? 100, 1000);
    const offset = filters.offset ?? 0;

    let query = this.db('diagnostic_events').select('*');

    if (filters.machineId) {
      query = query.where('machine_id', filters.machineId);
    }
    if (filters.eventType) {
      query = query.where('event_type', filters.eventType);
    }
    if (filters.sessionKey) {
      query = query.where('session_key', filters.sessionKey);
    }
    if (filters.since) {
      query = query.where('event_at', '>=', filters.since);
    }

    const rows = await query.orderBy('event_at', 'desc').limit(limit).offset(offset);
    return rows.map(this.toDiagnosticEvent);
  }

  async getRecentErrorCount(machineId?: string, sinceMinutes = 60): Promise<number> {
    const cutoff = new Date(Date.now() - sinceMinutes * 60_000).toISOString();
    let query = this.db('diagnostic_events')
      .where('event_at', '>=', cutoff)
      .where(function () {
        this.where('outcome', 'error')
          .orWhere('error_message', 'is not', null);
      })
      .count('* as cnt');

    if (machineId) {
      query = query.where('machine_id', machineId);
    }

    const result = await query.first();
    return Number(result?.cnt ?? 0);
  }

  // ─── Row Mappers ─────────────────────────────────────────────────

  private toSessionSnapshot(row: Record<string, unknown>): SessionSnapshot {
    return {
      id: row.id as number,
      machineId: row.machine_id as string,
      agentId: row.agent_id as string,
      sessionKey: row.session_key as string,
      sessionId: row.session_id as string | null,
      channel: row.channel as string | null,
      chatType: row.chat_type as string | null,
      originFrom: row.origin_from as string | null,
      originTo: row.origin_to as string | null,
      originProvider: row.origin_provider as string | null,
      originSurface: row.origin_surface as string | null,
      modelProvider: row.model_provider as string | null,
      model: row.model as string | null,
      thinkingLevel: row.thinking_level as string | null,
      inputTokens: Number(row.input_tokens ?? 0),
      outputTokens: Number(row.output_tokens ?? 0),
      totalTokens: Number(row.total_tokens ?? 0),
      cacheRead: Number(row.cache_read ?? 0),
      cacheWrite: Number(row.cache_write ?? 0),
      label: row.label as string | null,
      displayName: row.display_name as string | null,
      sendPolicy: row.send_policy as string | null,
      compactionCount: Number(row.compaction_count ?? 0),
      lastActivityAt: row.last_activity_at as string | null,
      snapshotAt: row.snapshot_at as string,
    };
  }

  private toSessionMessage(row: Record<string, unknown>): SessionMessage {
    return {
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
    };
  }

  private toGatewayLog(row: Record<string, unknown>): GatewayLog {
    let extraData: Record<string, unknown> | null = null;
    if (row.extra_data) {
      try {
        extraData = typeof row.extra_data === 'string' ? JSON.parse(row.extra_data) : row.extra_data as Record<string, unknown>;
      } catch { /* ignore */ }
    }
    return {
      id: Number(row.id),
      machineId: row.machine_id as string,
      logSource: row.log_source as GatewayLog['logSource'],
      level: row.level as string | null,
      subsystem: row.subsystem as string | null,
      message: row.message as string | null,
      sessionKey: row.session_key as string | null,
      sessionId: row.session_id as string | null,
      agentId: row.agent_id as string | null,
      channel: row.channel as string | null,
      extraData,
      loggedAt: row.logged_at as string,
      collectedAt: row.collected_at as string,
    };
  }

  private toDiagnosticEvent(row: Record<string, unknown>): DiagnosticEvent {
    const parseJson = (val: unknown): Record<string, unknown> | null => {
      if (!val) return null;
      try {
        return typeof val === 'string' ? JSON.parse(val) : val as Record<string, unknown>;
      } catch { return null; }
    };
    return {
      id: Number(row.id),
      machineId: row.machine_id as string,
      eventType: row.event_type as string,
      sessionKey: row.session_key as string | null,
      sessionId: row.session_id as string | null,
      channel: row.channel as string | null,
      provider: row.provider as string | null,
      model: row.model as string | null,
      durationMs: row.duration_ms != null ? Number(row.duration_ms) : null,
      outcome: row.outcome as string | null,
      errorMessage: row.error_message as string | null,
      tokenUsage: parseJson(row.token_usage),
      extraData: parseJson(row.extra_data),
      eventAt: row.event_at as string,
      collectedAt: row.collected_at as string,
    };
  }
}
