import { createChildLogger } from '../../shared/logger.js';
import type { SummaryRepository } from './summary.repository.js';
import type { AgentRepository } from '../agents/agent.repository.js';
import type { MachineRepository } from '../machines/machine.repository.js';
import type { GeminiClient } from './gemini-client.js';
import type { FeishuNotifier } from './feishu-notifier.js';
import type { SessionMessage } from '../monitoring/monitoring.types.js';
import type {
  GenerationTarget,
  GenerationResult,
  SummaryTrigger,
  SessionSummary,
} from './summary.types.js';

const log = createChildLogger('summary-service');

export interface SummaryServiceDeps {
  repo: SummaryRepository;
  agentRepo: AgentRepository;
  machineRepo: MachineRepository;
  gemini: GeminiClient;
  feishu: FeishuNotifier;
  windowHours: number;
}

const SYSTEM_PROMPT = `你是一个资深的业务复盘分析师，专门为客服/销售/支持类 AI Bot 的会话做"业务级完整总结"。

目标：让运营人员不必读原始对话就能**完整了解这段时间内所有业务细节**，用于后续复盘、问题跟进、改进 bot 表现。

输出要求：
1. 使用简洁中文，Markdown 格式。
2. 必须保留完整业务细节：客户原话要点（可适度引用）、关键数字/日期/订单号/金额、提到的产品/功能名、工具调用名称与结果、错误信息、未解决的问题。
3. 结构化分段，使用二级标题 (##) 分节，具体章节：
   - 概览：本时段总对话数、主要业务类型、整体情况一句话
   - 主要会话摘要：按会话拆分，每个会话用三级标题 (###) 写一段连贯摘要，包含：客户诉求 → bot 回复要点 → 后续互动 → 当前状态
   - 用户反馈与情绪：正面/负面/困惑的典型例子
   - 异常与错误：工具调用失败、LLM 错误、超时、未能回答的问题
   - 未完结事项：客户等待、需要人工介入、需要跟进的承诺
   - 数据统计：token、调用的模型、消耗情况
4. 不要编造不存在的信息。信息不足的字段写"无"或"未涉及"。
5. 不要输出开场白、自我介绍或免责声明，直接开始 Markdown 内容。`;

export class SummaryService {
  private repo: SummaryRepository;
  private agentRepo: AgentRepository;
  private machineRepo: MachineRepository;
  private gemini: GeminiClient;
  private feishu: FeishuNotifier;
  private windowHours: number;

  constructor(deps: SummaryServiceDeps) {
    this.repo = deps.repo;
    this.agentRepo = deps.agentRepo;
    this.machineRepo = deps.machineRepo;
    this.gemini = deps.gemini;
    this.feishu = deps.feishu;
    this.windowHours = deps.windowHours;
  }

  /**
   * Scheduled entry point. Runs once per cron tick (e.g. 00:00 / 12:00).
   * Summarizes the preceding `windowHours` for every bot that had messages.
   */
  async generateScheduled(periodEnd: Date = new Date()): Promise<GenerationResult[]> {
    const periodStart = new Date(periodEnd.getTime() - this.windowHours * 60 * 60 * 1000);
    const active = await this.repo.findActiveAgentsInWindow(periodStart, periodEnd);

    log.info(
      { periodStart, periodEnd, activeAgents: active.length },
      'Scheduled summary pass starting',
    );

    const results: GenerationResult[] = [];
    for (const agent of active) {
      const agentRow = await this.agentRepo.findByMachineAndAgentId(agent.machineId, agent.agentId);
      try {
        const r = await this.generateForAgent({
          machineId: agent.machineId,
          agentId: agent.agentId,
          agentUuid: agentRow?.id ?? null,
          agentName: agentRow?.name ?? null,
          periodStart,
          periodEnd,
          trigger: 'scheduled',
          forcePush: false,
        });
        results.push(r);
      } catch (err) {
        log.error(
          { err, machineId: agent.machineId, agentId: agent.agentId },
          'Summary generation failed for agent',
        );
        results.push({
          machineId: agent.machineId,
          agentId: agent.agentId,
          agentUuid: agentRow?.id ?? null,
          summaryId: null,
          status: 'failed',
          pushed: false,
          pushError: null,
          errorMessage: err instanceof Error ? err.message : String(err),
          sessionCount: 0,
          messageCount: agent.messageCount,
        });
      }
    }
    return results;
  }

  /**
   * Manual entry point driven by the UI: the user picks a set of bots and a
   * lookback of 1-14 days, and optionally chooses to force-push results to
   * Feishu (default true, matching the product decision that manual runs
   * always ship to the group).
   */
  async generateManual(input: {
    targets: GenerationTarget[];
    days: number;
    forcePush?: boolean;
  }): Promise<GenerationResult[]> {
    const days = Math.max(1, Math.min(14, Math.floor(input.days)));
    const periodEnd = new Date();
    const periodStart = new Date(periodEnd.getTime() - days * 24 * 60 * 60 * 1000);

    const forcePush = input.forcePush ?? true;

    log.info(
      { periodStart, periodEnd, targetCount: input.targets.length, forcePush },
      'Manual summary batch starting',
    );

    const results: GenerationResult[] = [];
    for (const target of input.targets) {
      try {
        const r = await this.generateForAgent({
          ...target,
          periodStart,
          periodEnd,
          trigger: 'manual',
          forcePush,
        });
        results.push(r);
      } catch (err) {
        log.error(
          { err, machineId: target.machineId, agentId: target.agentId },
          'Manual summary generation failed',
        );
        results.push({
          machineId: target.machineId,
          agentId: target.agentId,
          agentUuid: target.agentUuid,
          summaryId: null,
          status: 'failed',
          pushed: false,
          pushError: null,
          errorMessage: err instanceof Error ? err.message : String(err),
          sessionCount: 0,
          messageCount: 0,
        });
      }
    }
    return results;
  }

  // ─── Core pipeline ──────────────────────────────────────────────────

  private async generateForAgent(params: {
    machineId: string;
    agentId: string;
    agentUuid: string | null;
    agentName?: string | null;
    machineName?: string;
    periodStart: Date;
    periodEnd: Date;
    trigger: SummaryTrigger;
    forcePush: boolean;
  }): Promise<GenerationResult> {
    const {
      machineId, agentId, agentUuid, periodStart, periodEnd, trigger, forcePush,
    } = params;

    const messages = await this.repo.findMessagesInWindow(
      machineId, agentId, periodStart, periodEnd,
    );

    if (messages.length === 0) {
      // No activity in window: record an "empty" row so the UI can
      // distinguish "we checked and there was nothing" from "never ran".
      const summaryId = await this.repo.insertSummary({
        machineId,
        agentId,
        agentUuid,
        periodStartAt: periodStart,
        periodEndAt: periodEnd,
        sessionCount: 0,
        messageCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        model: this.gemini.getModel(),
        summaryMarkdown: null,
        trigger,
        status: 'empty',
      });
      return {
        machineId, agentId, agentUuid, summaryId,
        status: 'empty', pushed: false, pushError: null, errorMessage: null,
        sessionCount: 0, messageCount: 0,
      };
    }

    // Group by session_id while preserving order.
    const sessionMap = new Map<string, SessionMessage[]>();
    for (const m of messages) {
      const arr = sessionMap.get(m.sessionId) ?? [];
      arr.push(m);
      sessionMap.set(m.sessionId, arr);
    }

    const sessionCount = sessionMap.size;
    const messageCount = messages.length;
    const inputTokens = messages.reduce((s, m) => s + (m.inputTokens ?? 0), 0);
    const outputTokens = messages.reduce((s, m) => s + (m.outputTokens ?? 0), 0);
    const totalTokens = messages.reduce((s, m) => s + (m.totalTokens ?? 0), 0);

    // Resolve friendly labels (fetched once per bot; cheap).
    const agentRow = params.agentUuid
      ? await this.agentRepo.findById(params.agentUuid)
      : await this.agentRepo.findByMachineAndAgentId(machineId, agentId);
    const machineRow = await this.machineRepo.findById(machineId);
    const agentLabel = agentRow?.name || agentId;
    const machineLabel = machineRow?.name || machineId;

    const prompt = this.buildPrompt({
      agentLabel,
      machineLabel,
      agentId,
      periodStart,
      periodEnd,
      sessionCount,
      messageCount,
      inputTokens,
      outputTokens,
      totalTokens,
      sessionMap,
    });

    let summaryMarkdown: string | null = null;
    let status: 'success' | 'failed' = 'success';
    let errorMessage: string | null = null;

    try {
      const response = await this.gemini.generate({
        systemInstruction: SYSTEM_PROMPT,
        userPrompt: prompt,
        temperature: 0.2,
        maxOutputTokens: 8192,
      });
      summaryMarkdown = response.text;
    } catch (err) {
      status = 'failed';
      errorMessage = err instanceof Error ? err.message : String(err);
      log.error({ err, machineId, agentId }, 'Gemini generation failed');
    }

    const summaryId = await this.repo.insertSummary({
      machineId,
      agentId,
      agentUuid,
      periodStartAt: periodStart,
      periodEndAt: periodEnd,
      sessionCount,
      messageCount,
      inputTokens,
      outputTokens,
      totalTokens,
      model: this.gemini.getModel(),
      summaryMarkdown,
      trigger,
      status,
      errorMessage,
    });

    // Decide whether to push. Manual runs default to force-push; scheduled
    // runs honor each bot's summary_push_enabled toggle.
    let pushed = false;
    let pushError: string | null = null;
    if (status === 'success' && summaryMarkdown) {
      let shouldPush = forcePush;
      if (!shouldPush && trigger === 'scheduled') {
        shouldPush = await this.repo.isPushEnabled(machineId, agentId);
      }
      if (shouldPush) {
        if (!this.feishu.isConfigured()) {
          pushError = this.feishu.missingConfigHint();
        } else {
          try {
            await this.feishu.sendSummaryCard({
              title: `【${agentLabel}】会话总结`,
              subtitle: `${machineLabel} · ${formatWindow(periodStart, periodEnd)} · ${sessionCount} 会话 / ${messageCount} 消息`,
              markdown: summaryMarkdown,
            });
            pushed = true;
          } catch (err) {
            pushError = err instanceof Error ? err.message : String(err);
            log.warn({ err, machineId, agentId, summaryId }, 'Feishu push failed');
          }
        }
        await this.repo.updateFeishuStatus(summaryId, { pushed, error: pushError });
      }
    }

    return {
      machineId, agentId, agentUuid, summaryId,
      status, pushed, pushError, errorMessage,
      sessionCount, messageCount,
    };
  }

  private buildPrompt(args: {
    agentLabel: string;
    machineLabel: string;
    agentId: string;
    periodStart: Date;
    periodEnd: Date;
    sessionCount: number;
    messageCount: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    sessionMap: Map<string, SessionMessage[]>;
  }): string {
    const parts: string[] = [];

    parts.push(`# Bot 会话总结请求`);
    parts.push('');
    parts.push(`## 元数据`);
    parts.push(`- Bot 名称：${args.agentLabel}（agentId: ${args.agentId}）`);
    parts.push(`- 所在节点：${args.machineLabel}`);
    parts.push(`- 时间窗口：${formatWindow(args.periodStart, args.periodEnd)}`);
    parts.push(`- 会话数：${args.sessionCount}`);
    parts.push(`- 消息数：${args.messageCount}`);
    parts.push(`- Token 消耗：input=${args.inputTokens}, output=${args.outputTokens}, total=${args.totalTokens}`);
    parts.push('');
    parts.push(`## 原始对话内容`);
    parts.push('');

    let sessionIdx = 0;
    for (const [sessionId, msgs] of args.sessionMap) {
      sessionIdx++;
      const first = msgs[0];
      const last = msgs[msgs.length - 1];
      const firstTs = first.messageTimestamp ? new Date(first.messageTimestamp).toISOString() : '';
      const lastTs = last.messageTimestamp ? new Date(last.messageTimestamp).toISOString() : '';

      parts.push(`### 会话 ${sessionIdx} — session_id: ${sessionId}`);
      parts.push(`- 起止时间：${firstTs} ~ ${lastTs}`);
      parts.push(`- 消息数：${msgs.length}`);
      if (last.model) parts.push(`- 使用模型：${last.model}`);
      parts.push('');

      for (const m of msgs) {
        const ts = m.messageTimestamp ? new Date(m.messageTimestamp).toISOString() : '';
        const roleLabel = formatRole(m.role);
        const content = trimForPrompt(m.content ?? '');
        parts.push(`**[${roleLabel}]${ts ? ` ${ts}` : ''}**`);
        parts.push(content || '(空内容)');
        if (m.stopReason && m.stopReason !== 'end_turn') {
          parts.push(`_(stop_reason: ${m.stopReason})_`);
        }
        parts.push('');
      }
      parts.push('---');
      parts.push('');
    }

    parts.push(`## 输出任务`);
    parts.push(`请按照 system prompt 中约定的章节结构，对上述 ${args.sessionCount} 个会话做完整业务总结。`);

    return parts.join('\n');
  }

  // ─── Query passthrough (for routes) ─────────────────────────────────

  async listSummaries(filters: Parameters<SummaryRepository['listSummaries']>[0]) {
    return this.repo.listSummaries(filters);
  }
  async countSummaries(filters: Parameters<SummaryRepository['countSummaries']>[0]) {
    return this.repo.countSummaries(filters);
  }
  async getSummary(id: number): Promise<SessionSummary | null> {
    return this.repo.findById(id);
  }
  async listPushConfig() {
    return this.repo.listPushConfig();
  }
  async setPushEnabled(agentUuid: string, enabled: boolean) {
    return this.repo.setPushEnabled(agentUuid, enabled);
  }

  isGeminiConfigured(): boolean {
    return this.gemini.isConfigured();
  }
  isFeishuConfigured(): boolean {
    return this.feishu.isConfigured();
  }
  getFeishuHint(): string {
    return this.feishu.missingConfigHint();
  }
  getModelName(): string {
    return this.gemini.getModel();
  }
  getWindowHours(): number {
    return this.windowHours;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────

function formatWindow(from: Date, to: Date): string {
  return `${formatLocal(from)} ~ ${formatLocal(to)}`;
}

function formatLocal(d: Date): string {
  // Shanghai-ish local string, intentionally not tied to the server tz
  // offset so it's consistent across env. Example: 2025-08-12 10:00.
  const iso = new Date(d.getTime() + 8 * 60 * 60 * 1000).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

function formatRole(role: string): string {
  switch (role) {
    case 'user': return '用户';
    case 'assistant': return 'Bot';
    case 'system': return '系统';
    case 'tool': return '工具';
    default: return role;
  }
}

/**
 * Per-message prompt budget. Individual messages can be huge (dumped tool
 * outputs, transcripts), and if we send a 500K char prompt to Gemini the
 * request either fails or wastes quota. 6000 chars preserves real dialog
 * detail while keeping the total payload bounded.
 */
function trimForPrompt(text: string): string {
  const MAX = 6000;
  if (text.length <= MAX) return text;
  const head = text.slice(0, MAX - 200);
  return `${head}\n...(已截断，原始长度 ${text.length} 字符)`;
}
