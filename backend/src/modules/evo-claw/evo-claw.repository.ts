import { getDb, type Knex } from '../../shared/db.js';
import type {
  EvoRun,
  CreateEvoRunInput,
  EvoRunStatus,
  EvoRunFilters,
  EvoSignal,
  InsertEvoSignalInput,
  EvoRule,
  InsertEvoRuleInput,
  UpdateEvoRuleInput,
  EvoRuleFilters,
  EvoCase,
  InsertEvoCaseInput,
  UpdateEvoCaseInput,
  EvoCaseFilters,
} from './evo-claw.types.js';

export class EvoClawRepository {
  private get db(): Knex {
    return getDb();
  }

  // ─── Evo Runs ───────────────────────────────────────────────────────

  async createRun(input: CreateEvoRunInput): Promise<number> {
    const [id] = await this.db('evo_runs').insert({
      machine_id: input.machineId,
      agent_id: input.agentId,
      trigger_type: input.triggerType,
      status: 'pending',
      started_at: this.db.fn.now(),
    });
    return id;
  }

  async updateRunStatus(
    runId: number,
    status: EvoRunStatus,
    extra?: {
      sessionsAnalyzed?: number;
      signalsFound?: number;
      rulesGenerated?: number;
      casesGenerated?: number;
      summary?: string;
      errorMessage?: string;
    },
  ): Promise<void> {
    const update: Record<string, unknown> = { status };
    if (extra?.sessionsAnalyzed !== undefined) update.sessions_analyzed = extra.sessionsAnalyzed;
    if (extra?.signalsFound !== undefined) update.signals_found = extra.signalsFound;
    if (extra?.rulesGenerated !== undefined) update.rules_generated = extra.rulesGenerated;
    if (extra?.casesGenerated !== undefined) update.cases_generated = extra.casesGenerated;
    if (extra?.summary !== undefined) update.summary = extra.summary;
    if (extra?.errorMessage !== undefined) update.error_message = extra.errorMessage;
    if (status === 'completed' || status === 'failed') {
      update.completed_at = this.db.fn.now();
    }
    await this.db('evo_runs').where('id', runId).update(update);
  }

  async findRunById(runId: number): Promise<EvoRun | null> {
    const row = await this.db('evo_runs').where('id', runId).first();
    return row ? this.toEvoRun(row) : null;
  }

  async findRuns(filters: EvoRunFilters): Promise<EvoRun[]> {
    const limit = Math.min(filters.limit ?? 50, 200);
    const offset = filters.offset ?? 0;
    let query = this.db('evo_runs').select('*');
    if (filters.machineId) query = query.where('machine_id', filters.machineId);
    if (filters.agentId) query = query.where('agent_id', filters.agentId);
    if (filters.status) query = query.where('status', filters.status);
    const rows = await query.orderBy('created_at', 'desc').limit(limit).offset(offset);
    return rows.map(this.toEvoRun);
  }

  async findLastCompletedRun(machineId: string, agentId: string): Promise<EvoRun | null> {
    const row = await this.db('evo_runs')
      .where({ machine_id: machineId, agent_id: agentId, status: 'completed' })
      .orderBy('completed_at', 'desc')
      .first();
    return row ? this.toEvoRun(row) : null;
  }

  async countRunsSinceRuleCreated(ruleId: number): Promise<number> {
    const rule = await this.db('evo_rules').where('id', ruleId).select('machine_id', 'agent_id', 'created_at').first();
    if (!rule) return 0;
    const result = await this.db('evo_runs')
      .where({ machine_id: rule.machine_id, agent_id: rule.agent_id, status: 'completed' })
      .where('completed_at', '>', rule.created_at)
      .count('* as cnt')
      .first();
    return Number(result?.cnt ?? 0);
  }

  // ─── Evo Signals ───────────────────────────────────────────────────

  async insertSignals(inputs: InsertEvoSignalInput[]): Promise<number[]> {
    if (inputs.length === 0) return [];
    const ids: number[] = [];
    for (const input of inputs) {
      const [id] = await this.db('evo_signals').insert({
        machine_id: input.machineId,
        agent_id: input.agentId,
        evo_run_id: input.evoRunId,
        signal_type: input.signalType,
        polarity: input.polarity ?? null,
        source_session_id: input.sourceSessionId,
        message_index_start: input.messageIndexStart,
        message_index_end: input.messageIndexEnd,
        raw_content: input.rawContent,
        hint: input.hint ?? null,
        classification_reason: input.classificationReason ?? null,
        processed: false,
      });
      ids.push(id);
    }
    return ids;
  }

  async markSignalsProcessed(signalIds: number[]): Promise<void> {
    if (signalIds.length === 0) return;
    await this.db('evo_signals').whereIn('id', signalIds).update({ processed: true });
  }

  async findSignalsByRunId(runId: number): Promise<EvoSignal[]> {
    const rows = await this.db('evo_signals')
      .where('evo_run_id', runId)
      .orderBy('id', 'asc');
    return rows.map(this.toEvoSignal);
  }

  async findUnprocessedNegativeSignals(runId: number): Promise<EvoSignal[]> {
    const rows = await this.db('evo_signals')
      .where({ evo_run_id: runId, signal_type: 'evaluative', polarity: 'negative', processed: false })
      .orderBy('id', 'asc');
    return rows.map(this.toEvoSignal);
  }

  async findUnprocessedInstructiveSignals(runId: number): Promise<EvoSignal[]> {
    const rows = await this.db('evo_signals')
      .where({ evo_run_id: runId, signal_type: 'instructive', processed: false })
      .orderBy('id', 'asc');
    return rows.map(this.toEvoSignal);
  }

  // ─── Evo Rules ──────────────────────────────────────────────────────

  async insertRule(input: InsertEvoRuleInput): Promise<number> {
    const [id] = await this.db('evo_rules').insert({
      machine_id: input.machineId,
      agent_id: input.agentId,
      evo_run_id: input.evoRunId,
      rule_key: input.ruleKey,
      rule_type: input.ruleType,
      content: input.content,
      target_file: input.targetFile,
      target_section: input.targetSection ?? null,
      source_signal_ids: input.sourceSignalIds ? JSON.stringify(input.sourceSignalIds) : null,
      confidence_score: input.confidenceScore ?? 0,
      status: 'active',
    });
    return id;
  }

  async updateRule(ruleId: number, update: UpdateEvoRuleInput): Promise<void> {
    const row: Record<string, unknown> = { updated_at: this.db.fn.now() };
    if (update.content !== undefined) row.content = update.content;
    if (update.status !== undefined) row.status = update.status;
    if (update.targetSection !== undefined) row.target_section = update.targetSection;
    if (update.confidenceScore !== undefined) row.confidence_score = update.confidenceScore;
    if (update.mergedIntoId !== undefined) row.merged_into_id = update.mergedIntoId;
    if (update.deprecatedAt !== undefined) row.deprecated_at = update.deprecatedAt;
    await this.db('evo_rules').where('id', ruleId).update(row);
  }

  async deprecateRule(ruleId: number, mergedIntoId?: number): Promise<void> {
    await this.db('evo_rules').where('id', ruleId).update({
      status: mergedIntoId ? 'merged' : 'deprecated',
      merged_into_id: mergedIntoId ?? null,
      deprecated_at: this.db.fn.now(),
      updated_at: this.db.fn.now(),
    });
  }

  async incrementRuleTriggerCount(ruleId: number): Promise<void> {
    await this.db('evo_rules').where('id', ruleId)
      .increment('trigger_count', 1)
      .update({ updated_at: this.db.fn.now() });
  }

  async incrementRuleFeedback(ruleId: number, positive: boolean): Promise<void> {
    const col = positive ? 'positive_feedback_count' : 'negative_feedback_count';
    await this.db('evo_rules').where('id', ruleId)
      .increment(col, 1)
      .update({ updated_at: this.db.fn.now() });
  }

  async findRuleById(ruleId: number): Promise<EvoRule | null> {
    const row = await this.db('evo_rules').where('id', ruleId).first();
    return row ? this.toEvoRule(row) : null;
  }

  async findRules(filters: EvoRuleFilters): Promise<EvoRule[]> {
    const limit = Math.min(filters.limit ?? 100, 500);
    const offset = filters.offset ?? 0;
    let query = this.db('evo_rules').select('*');
    if (filters.machineId) query = query.where('machine_id', filters.machineId);
    if (filters.agentId) query = query.where('agent_id', filters.agentId);
    if (filters.status) query = query.where('status', filters.status);
    if (filters.targetFile) query = query.where('target_file', filters.targetFile);
    const rows = await query.orderBy('created_at', 'desc').limit(limit).offset(offset);
    return rows.map(this.toEvoRule);
  }

  async findActiveRulesForAgent(machineId: string, agentId: string): Promise<EvoRule[]> {
    const rows = await this.db('evo_rules')
      .where({ machine_id: machineId, agent_id: agentId, status: 'active' })
      .orderBy('target_file', 'asc')
      .orderBy('created_at', 'asc');
    return rows.map(this.toEvoRule);
  }

  async findActiveRulesByFile(machineId: string, agentId: string, targetFile: string): Promise<EvoRule[]> {
    const rows = await this.db('evo_rules')
      .where({ machine_id: machineId, agent_id: agentId, target_file: targetFile, status: 'active' })
      .orderBy('created_at', 'asc');
    return rows.map(this.toEvoRule);
  }

  async countActiveRulesByFile(machineId: string, agentId: string, targetFile: string): Promise<number> {
    const result = await this.db('evo_rules')
      .where({ machine_id: machineId, agent_id: agentId, target_file: targetFile, status: 'active' })
      .count('* as cnt')
      .first();
    return Number(result?.cnt ?? 0);
  }

  async findRuleByKey(machineId: string, agentId: string, ruleKey: string): Promise<EvoRule | null> {
    const row = await this.db('evo_rules')
      .where({ machine_id: machineId, agent_id: agentId, rule_key: ruleKey })
      .first();
    return row ? this.toEvoRule(row) : null;
  }

  // ─── Evo Cases ──────────────────────────────────────────────────────

  async insertCase(input: InsertEvoCaseInput): Promise<number> {
    const [id] = await this.db('evo_cases').insert({
      machine_id: input.machineId,
      agent_id: input.agentId,
      evo_run_id: input.evoRunId,
      case_key: input.caseKey,
      scenario: input.scenario,
      user_question_summary: input.userQuestionSummary,
      bot_wrong_answer_summary: input.botWrongAnswerSummary,
      user_correction: input.userCorrection,
      correct_approach: input.correctApproach,
      source_signal_ids: input.sourceSignalIds ? JSON.stringify(input.sourceSignalIds) : null,
      status: 'active',
    });
    return id;
  }

  async updateCase(caseId: number, update: UpdateEvoCaseInput): Promise<void> {
    const row: Record<string, unknown> = { updated_at: this.db.fn.now() };
    if (update.scenario !== undefined) row.scenario = update.scenario;
    if (update.correctApproach !== undefined) row.correct_approach = update.correctApproach;
    if (update.status !== undefined) row.status = update.status;
    if (update.mergedIntoId !== undefined) row.merged_into_id = update.mergedIntoId;
    await this.db('evo_cases').where('id', caseId).update(row);
  }

  async deprecateCase(caseId: number, mergedIntoId?: number): Promise<void> {
    await this.db('evo_cases').where('id', caseId).update({
      status: mergedIntoId ? 'merged' : 'deprecated',
      merged_into_id: mergedIntoId ?? null,
      updated_at: this.db.fn.now(),
    });
  }

  async incrementCaseRelevance(caseId: number): Promise<void> {
    await this.db('evo_cases').where('id', caseId)
      .increment('relevance_count', 1)
      .update({ updated_at: this.db.fn.now() });
  }

  async findCaseById(caseId: number): Promise<EvoCase | null> {
    const row = await this.db('evo_cases').where('id', caseId).first();
    return row ? this.toEvoCase(row) : null;
  }

  async findCases(filters: EvoCaseFilters): Promise<EvoCase[]> {
    const limit = Math.min(filters.limit ?? 100, 500);
    const offset = filters.offset ?? 0;
    let query = this.db('evo_cases').select('*');
    if (filters.machineId) query = query.where('machine_id', filters.machineId);
    if (filters.agentId) query = query.where('agent_id', filters.agentId);
    if (filters.status) query = query.where('status', filters.status);
    const rows = await query.orderBy('created_at', 'desc').limit(limit).offset(offset);
    return rows.map(this.toEvoCase);
  }

  async findActiveCasesForAgent(machineId: string, agentId: string): Promise<EvoCase[]> {
    const rows = await this.db('evo_cases')
      .where({ machine_id: machineId, agent_id: agentId, status: 'active' })
      .orderBy('created_at', 'asc');
    return rows.map(this.toEvoCase);
  }

  async findCaseByKey(machineId: string, agentId: string, caseKey: string): Promise<EvoCase | null> {
    const row = await this.db('evo_cases')
      .where({ machine_id: machineId, agent_id: agentId, case_key: caseKey })
      .first();
    return row ? this.toEvoCase(row) : null;
  }

  // ─── Row Mappers ────────────────────────────────────────────────────

  private toEvoRun(row: Record<string, unknown>): EvoRun {
    return {
      id: Number(row.id),
      machineId: row.machine_id as string,
      agentId: row.agent_id as string,
      triggerType: row.trigger_type as EvoRun['triggerType'],
      status: row.status as EvoRun['status'],
      sessionsAnalyzed: Number(row.sessions_analyzed ?? 0),
      signalsFound: Number(row.signals_found ?? 0),
      rulesGenerated: Number(row.rules_generated ?? 0),
      casesGenerated: Number(row.cases_generated ?? 0),
      summary: row.summary as string | null,
      errorMessage: row.error_message as string | null,
      startedAt: row.started_at as string | null,
      completedAt: row.completed_at as string | null,
      createdAt: row.created_at as string,
    };
  }

  private toEvoSignal(row: Record<string, unknown>): EvoSignal {
    return {
      id: Number(row.id),
      machineId: row.machine_id as string,
      agentId: row.agent_id as string,
      evoRunId: Number(row.evo_run_id),
      signalType: row.signal_type as EvoSignal['signalType'],
      polarity: row.polarity as EvoSignal['polarity'],
      sourceSessionId: row.source_session_id as string,
      messageIndexStart: Number(row.message_index_start),
      messageIndexEnd: Number(row.message_index_end),
      rawContent: row.raw_content as string,
      hint: row.hint as string | null,
      classificationReason: row.classification_reason as string | null,
      processed: Boolean(row.processed),
      createdAt: row.created_at as string,
    };
  }

  private toEvoRule(row: Record<string, unknown>): EvoRule {
    let sourceSignalIds: number[] | null = null;
    if (row.source_signal_ids) {
      try {
        sourceSignalIds = typeof row.source_signal_ids === 'string'
          ? JSON.parse(row.source_signal_ids)
          : row.source_signal_ids as number[];
      } catch { /* ignore */ }
    }
    return {
      id: Number(row.id),
      machineId: row.machine_id as string,
      agentId: row.agent_id as string,
      evoRunId: Number(row.evo_run_id),
      ruleKey: row.rule_key as string,
      ruleType: row.rule_type as EvoRule['ruleType'],
      content: row.content as string,
      targetFile: row.target_file as EvoRule['targetFile'],
      targetSection: row.target_section as string | null,
      sourceSignalIds,
      status: row.status as EvoRule['status'],
      confidenceScore: Number(row.confidence_score ?? 0),
      triggerCount: Number(row.trigger_count ?? 0),
      positiveFeedbackCount: Number(row.positive_feedback_count ?? 0),
      negativeFeedbackCount: Number(row.negative_feedback_count ?? 0),
      mergedIntoId: row.merged_into_id != null ? Number(row.merged_into_id) : null,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
      deprecatedAt: row.deprecated_at as string | null,
    };
  }

  private toEvoCase(row: Record<string, unknown>): EvoCase {
    let sourceSignalIds: number[] | null = null;
    if (row.source_signal_ids) {
      try {
        sourceSignalIds = typeof row.source_signal_ids === 'string'
          ? JSON.parse(row.source_signal_ids)
          : row.source_signal_ids as number[];
      } catch { /* ignore */ }
    }
    return {
      id: Number(row.id),
      machineId: row.machine_id as string,
      agentId: row.agent_id as string,
      evoRunId: Number(row.evo_run_id),
      caseKey: row.case_key as string,
      scenario: row.scenario as string,
      userQuestionSummary: row.user_question_summary as string,
      botWrongAnswerSummary: row.bot_wrong_answer_summary as string,
      userCorrection: row.user_correction as string,
      correctApproach: row.correct_approach as string,
      sourceSignalIds,
      status: row.status as EvoCase['status'],
      relevanceCount: Number(row.relevance_count ?? 0),
      mergedIntoId: row.merged_into_id != null ? Number(row.merged_into_id) : null,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }
}
