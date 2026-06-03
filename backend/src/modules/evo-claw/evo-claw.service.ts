import { createHash } from 'node:crypto';
import { createChildLogger } from '../../shared/logger.js';
import type { MonitoringRepository } from '../monitoring/monitoring.repository.js';
import type { FileRepository } from '../files/file.repository.js';
import type { AgentRepository } from '../agents/agent.repository.js';
import type { SyncEngine } from '../sync/sync-engine.js';
import type { MachineService } from '../machines/machine.service.js';
import type { EvoClawRepository } from './evo-claw.repository.js';
import { EvoClawJudge } from './evo-claw.judge.js';
import { EvoClawDistiller } from './evo-claw.distiller.js';
import { EvoClawController } from './evo-claw.controller.js';
import type {
  EvoTriggerType,
  EvoRun,
  EvoRule,
  EvoCase,
  ConversationTurn,
  EvoRunFilters,
  EvoRuleFilters,
  EvoCaseFilters,
  UpdateEvoRuleInput,
  UpdateEvoCaseInput,
  EvoTargetFile,
} from './evo-claw.types.js';
import { ECA_SECTION_BEGIN, ECA_SECTION_END } from './evo-claw.types.js';

const log = createChildLogger('evo-claw');

export interface EvoClawServiceDeps {
  evoRepo: EvoClawRepository;
  monitoringRepo: MonitoringRepository;
  fileRepo: FileRepository;
  agentRepo: AgentRepository;
  syncEngine: SyncEngine;
  machineService: MachineService;
  modelName: string;
  maxRulesPerFile: number;
  decayThresholdRuns: number;
  minSessions: number;
}

export class EvoClawService {
  private evoRepo: EvoClawRepository;
  private monitoringRepo: MonitoringRepository;
  private fileRepo: FileRepository;
  private agentRepo: AgentRepository;
  private syncEngine: SyncEngine;
  private machineService: MachineService;
  private judge: EvoClawJudge;
  private distiller: EvoClawDistiller;
  private controller: EvoClawController;
  private minSessions: number;

  constructor(deps: EvoClawServiceDeps) {
    this.evoRepo = deps.evoRepo;
    this.monitoringRepo = deps.monitoringRepo;
    this.fileRepo = deps.fileRepo;
    this.agentRepo = deps.agentRepo;
    this.syncEngine = deps.syncEngine;
    this.machineService = deps.machineService;
    this.judge = new EvoClawJudge(deps.modelName);
    this.distiller = new EvoClawDistiller(deps.modelName);
    this.controller = new EvoClawController(deps.modelName, deps.evoRepo, {
      maxRulesPerFile: deps.maxRulesPerFile,
      decayThresholdRuns: deps.decayThresholdRuns,
    });
    this.minSessions = deps.minSessions;
  }

  // ─── Pipeline Entry Point ──────────────────────────────────────────

  async triggerEvolution(
    machineId: string,
    agentId: string,
    triggerType: EvoTriggerType,
  ): Promise<EvoRun> {
    const runId = await this.evoRepo.createRun({ machineId, agentId, triggerType });
    log.info({ runId, machineId, agentId, triggerType }, 'Evolution run started');

    try {
      await this.evoRepo.updateRunStatus(runId, 'collecting');
      const turns = await this.collectConversationTurns(machineId, agentId);

      if (turns.length === 0) {
        await this.evoRepo.updateRunStatus(runId, 'completed', {
          sessionsAnalyzed: 0,
          summary: 'No new conversation turns to analyze.',
        });
        return (await this.evoRepo.findRunById(runId))!;
      }

      const sessionIds = new Set(turns.map((t) => t.sessionId));
      await this.evoRepo.updateRunStatus(runId, 'classifying', {
        sessionsAnalyzed: sessionIds.size,
      });

      const verdicts = await this.judge.classifyTurns(turns);
      let signalsFound = 0;

      for (let i = 0; i < turns.length; i++) {
        const turn = turns[i];
        const verdict = verdicts[i];
        if (verdict.signalType === 'none') continue;

        const rawContent = [
          `[user]: ${turn.userMessage}`,
          `[assistant]: ${turn.botResponse}`,
          `[user follow-up]: ${turn.userFollowUp}`,
        ].join('\n');

        await this.evoRepo.insertSignals([{
          machineId,
          agentId,
          evoRunId: runId,
          signalType: verdict.signalType === 'instructive' ? 'instructive' : 'evaluative',
          polarity: verdict.polarity ?? null,
          sourceSessionId: turn.sessionId,
          messageIndexStart: turn.messageIndexStart,
          messageIndexEnd: turn.messageIndexEnd,
          rawContent,
          hint: verdict.hint ?? null,
          classificationReason: verdict.reason,
        }]);
        signalsFound++;
      }

      await this.evoRepo.updateRunStatus(runId, 'distilling', { signalsFound });

      const negSignals = await this.evoRepo.findUnprocessedNegativeSignals(runId);
      const instrSignals = await this.evoRepo.findUnprocessedInstructiveSignals(runId);

      const distilledRules = await this.distiller.distillRules(negSignals);
      const distilledCases = await this.distiller.distillCases(instrSignals);

      let rulesGenerated = 0;
      for (const dr of distilledRules) {
        const existingRules = await this.evoRepo.findActiveRulesByFile(machineId, agentId, dr.targetFile);
        const conflict = await this.controller.checkConflict(dr, existingRules);

        if (conflict.hasConflict && conflict.conflictingRuleId) {
          if (conflict.resolution === 'merge' && conflict.mergedContent) {
            await this.evoRepo.updateRule(conflict.conflictingRuleId, {
              content: conflict.mergedContent,
            });
            log.info({ ruleId: conflict.conflictingRuleId }, 'Merged with existing rule');
          } else if (conflict.resolution === 'supersede') {
            await this.evoRepo.deprecateRule(conflict.conflictingRuleId);
            await this.evoRepo.insertRule({
              machineId, agentId, evoRunId: runId,
              ruleKey: dr.ruleKey, ruleType: dr.ruleType,
              content: dr.content, targetFile: dr.targetFile,
              targetSection: dr.targetSection,
              sourceSignalIds: dr.sourceSignalIds,
              confidenceScore: dr.confidenceScore,
            });
            rulesGenerated++;
          }
        } else {
          const existingByKey = await this.evoRepo.findRuleByKey(machineId, agentId, dr.ruleKey);
          if (existingByKey && existingByKey.status === 'active') {
            await this.evoRepo.updateRule(existingByKey.id, { content: dr.content });
          } else {
            await this.evoRepo.insertRule({
              machineId, agentId, evoRunId: runId,
              ruleKey: dr.ruleKey, ruleType: dr.ruleType,
              content: dr.content, targetFile: dr.targetFile,
              targetSection: dr.targetSection,
              sourceSignalIds: dr.sourceSignalIds,
              confidenceScore: dr.confidenceScore,
            });
            rulesGenerated++;
          }
        }
      }

      let casesGenerated = 0;
      const existingCases = await this.evoRepo.findActiveCasesForAgent(machineId, agentId);
      for (const dc of distilledCases) {
        const similarity = await this.controller.checkCaseSimilarity(dc, existingCases);
        if (similarity.similarCaseId) {
          await this.evoRepo.updateCase(similarity.similarCaseId, {
            correctApproach: similarity.mergedApproach ?? dc.correctApproach,
          });
          await this.evoRepo.incrementCaseRelevance(similarity.similarCaseId);
        } else {
          await this.evoRepo.insertCase({
            machineId, agentId, evoRunId: runId,
            caseKey: dc.caseKey,
            scenario: dc.scenario,
            userQuestionSummary: dc.userQuestionSummary,
            botWrongAnswerSummary: dc.botWrongAnswerSummary,
            userCorrection: dc.userCorrection,
            correctApproach: dc.correctApproach,
            sourceSignalIds: dc.sourceSignalIds,
          });
          casesGenerated++;
        }
      }

      const processedSignalIds = [
        ...negSignals.map((s) => s.id),
        ...instrSignals.map((s) => s.id),
      ];
      await this.evoRepo.markSignalsProcessed(processedSignalIds);

      // Evolution control: compression + decay
      const targetFiles: EvoTargetFile[] = ['SOUL.md', 'TOOLS.md', 'AGENTS.md'];
      for (const tf of targetFiles) {
        const compression = await this.controller.compressRules(machineId, agentId, tf);
        if (compression) {
          for (const cr of compression.compressedRules) {
            for (const oldId of cr.mergedFromIds) {
              await this.evoRepo.deprecateRule(oldId);
            }
            await this.evoRepo.insertRule({
              machineId, agentId, evoRunId: runId,
              ruleKey: cr.ruleKey, ruleType: 'constraint',
              content: cr.content, targetFile: tf,
              targetSection: 'Compressed Rules',
            });
          }
        }
      }

      await this.controller.runDecay(machineId, agentId);

      await this.evoRepo.updateRunStatus(runId, 'applying', { rulesGenerated, casesGenerated });
      await this.applyEvolution(machineId, agentId);

      await this.evoRepo.updateRunStatus(runId, 'completed', {
        rulesGenerated,
        casesGenerated,
        summary: `Analyzed ${sessionIds.size} sessions, found ${signalsFound} signals, generated ${rulesGenerated} rules and ${casesGenerated} cases.`,
      });

      log.info({ runId, rulesGenerated, casesGenerated }, 'Evolution run completed');
    } catch (err) {
      log.error({ err, runId }, 'Evolution run failed');
      await this.evoRepo.updateRunStatus(runId, 'failed', {
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    }

    return (await this.evoRepo.findRunById(runId))!;
  }

  // ─── Signal Collection ─────────────────────────────────────────────

  private async collectConversationTurns(
    machineId: string,
    agentId: string,
  ): Promise<ConversationTurn[]> {
    const lastRun = await this.evoRepo.findLastCompletedRun(machineId, agentId);
    const since = lastRun?.completedAt ?? new Date(0).toISOString();

    const sessions = await this.monitoringRepo.findSessionSnapshots({
      machineId,
      agentId,
      limit: 500,
    });

    const turns: ConversationTurn[] = [];

    for (const session of sessions) {
      if (!session.sessionId) continue;
      if (session.lastActivityAt && session.lastActivityAt < since) continue;

      const messages = await this.monitoringRepo.findSessionMessages({
        machineId,
        sessionId: session.sessionId,
        agentId,
        limit: 1000,
      });

      const userAssistantMsgs = messages.filter(
        (m) => (m.role === 'user' || m.role === 'assistant') && m.content,
      );

      for (let i = 0; i < userAssistantMsgs.length - 2; i++) {
        const msg1 = userAssistantMsgs[i];
        const msg2 = userAssistantMsgs[i + 1];
        const msg3 = userAssistantMsgs[i + 2];

        if (msg1.role !== 'user' || msg2.role !== 'assistant' || msg3.role !== 'user') continue;

        const precedingContext = userAssistantMsgs.slice(Math.max(0, i - 4), i)
          .map((m) => ({ role: m.role, content: m.content ?? '' }));

        turns.push({
          sessionId: session.sessionId,
          messageIndexStart: msg1.messageIndex,
          messageIndexEnd: msg3.messageIndex,
          userMessage: msg1.content ?? '',
          botResponse: msg2.content ?? '',
          userFollowUp: msg3.content ?? '',
          precedingContext,
        });
      }
    }

    return turns;
  }

  // ─── Apply Evolution to Files ──────────────────────────────────────

  private async applyEvolution(machineId: string, agentId: string): Promise<void> {
    const agent = await this.agentRepo.findByMachineAndAgentId(machineId, agentId);
    if (!agent) {
      log.warn({ machineId, agentId }, 'Agent not found, skipping file application');
      return;
    }

    const workspacePath = agent.workspacePath ?? `workspace-${agentId}`;
    const activeRules = await this.evoRepo.findActiveRulesForAgent(machineId, agentId);
    const activeCases = await this.evoRepo.findActiveCasesForAgent(machineId, agentId);

    const rulesByFile = new Map<string, EvoRule[]>();
    for (const rule of activeRules) {
      const existing = rulesByFile.get(rule.targetFile) ?? [];
      existing.push(rule);
      rulesByFile.set(rule.targetFile, existing);
    }

    const modifiedPaths: string[] = [];

    for (const [targetFile, rules] of rulesByFile) {
      const relativePath = `${workspacePath}/${targetFile}`;
      const ecaContent = this.generateEcaSection(rules);
      await this.upsertEcaSection(machineId, relativePath, ecaContent);
      modifiedPaths.push(relativePath);
    }

    if (activeCases.length > 0) {
      const skillPath = `${workspacePath}/skills/evo-cases/SKILL.md`;
      const skillContent = this.generateCaseSkill(activeCases);
      await this.upsertFileContent(machineId, skillPath, skillContent);
      modifiedPaths.push(skillPath);
    }

    if (modifiedPaths.length > 0) {
      try {
        const machine = await this.machineService.getMachine(machineId);
        const connInfo = this.machineService.toConnectionInfo(machine);
        await this.syncEngine.executePush(
          machineId,
          connInfo,
          machine.openclawHome ?? '~/.openclaw',
          'evo-claw',
          modifiedPaths,
        );
      } catch (err) {
        log.error({ err, machineId }, 'Sync push failed after evolution');
      }
    }
  }

  private generateEcaSection(rules: EvoRule[]): string {
    const grouped = new Map<string, EvoRule[]>();
    for (const rule of rules) {
      const section = rule.targetSection ?? 'General';
      const existing = grouped.get(section) ?? [];
      existing.push(rule);
      grouped.set(section, existing);
    }

    const parts: string[] = [];
    for (const [section, sectionRules] of grouped) {
      parts.push(`## ${section}\n`);
      for (const rule of sectionRules) {
        parts.push(`- ${rule.content}`);
      }
      parts.push('');
    }
    return parts.join('\n').trim();
  }

  private async upsertEcaSection(
    machineId: string,
    relativePath: string,
    ecaContent: string,
  ): Promise<void> {
    const existing = await this.fileRepo.findByPath(machineId, relativePath);
    let fullContent: string;

    const ecaBlock = `${ECA_SECTION_BEGIN}\n${ecaContent}\n${ECA_SECTION_END}`;

    if (existing?.content) {
      const beginIdx = existing.content.indexOf(ECA_SECTION_BEGIN);
      const endIdx = existing.content.indexOf(ECA_SECTION_END);

      if (beginIdx !== -1 && endIdx !== -1) {
        fullContent =
          existing.content.slice(0, beginIdx) +
          ecaBlock +
          existing.content.slice(endIdx + ECA_SECTION_END.length);
      } else {
        fullContent = existing.content.trimEnd() + '\n\n' + ecaBlock + '\n';
      }
    } else {
      fullContent = ecaBlock + '\n';
    }

    await this.upsertFileContent(machineId, relativePath, fullContent);
  }

  private async upsertFileContent(
    machineId: string,
    relativePath: string,
    content: string,
  ): Promise<void> {
    const contentHash = createHash('sha256').update(content).digest('hex');
    await this.fileRepo.upsertFile({
      machineId,
      relativePath,
      content,
      contentHash,
      remoteHash: null,
      remoteMtime: null,
      remoteSize: null,
      localDirty: true,
      remoteDirty: false,
    });
  }

  private generateCaseSkill(cases: EvoCase[]): string {
    const parts: string[] = [
      '---',
      'name: evo-cases',
      'description: Auto-evolved case library from user interaction feedback',
      `version: "${new Date().toISOString().slice(0, 10)}"`,
      'tags: [evo, cases, auto-evolved]',
      '---',
      '',
      '# Evolved Case Library',
      '',
    ];

    for (const c of cases) {
      parts.push(`## Case: ${c.scenario}`);
      parts.push(`**Scenario**: ${c.scenario}`);
      parts.push(`**Correct Approach**: ${c.correctApproach}`);
      parts.push(`**Avoid**: ${c.botWrongAnswerSummary}`);
      parts.push('');
    }

    return parts.join('\n');
  }

  // ─── Query Methods (for routes) ────────────────────────────────────

  async listRuns(filters: EvoRunFilters): Promise<EvoRun[]> {
    return this.evoRepo.findRuns(filters);
  }

  async getRunDetail(runId: number): Promise<EvoRun | null> {
    return this.evoRepo.findRunById(runId);
  }

  async listRules(filters: EvoRuleFilters): Promise<EvoRule[]> {
    return this.evoRepo.findRules(filters);
  }

  async listCases(filters: EvoCaseFilters): Promise<EvoCase[]> {
    return this.evoRepo.findCases(filters);
  }

  async updateRule(ruleId: number, update: UpdateEvoRuleInput): Promise<void> {
    await this.evoRepo.updateRule(ruleId, update);
  }

  async deprecateRule(ruleId: number): Promise<void> {
    await this.evoRepo.deprecateRule(ruleId);
  }

  async deprecateCase(caseId: number): Promise<void> {
    await this.evoRepo.deprecateCase(caseId);
  }

  async updateCase(caseId: number, update: UpdateEvoCaseInput): Promise<void> {
    await this.evoRepo.updateCase(caseId, update);
  }

  async getRunSignals(runId: number) {
    return this.evoRepo.findSignalsByRunId(runId);
  }

  async shouldRunEvolution(machineId: string, agentId: string): Promise<boolean> {
    const lastRun = await this.evoRepo.findLastCompletedRun(machineId, agentId);
    const since = lastRun?.completedAt ?? new Date(0).toISOString();

    const sessions = await this.monitoringRepo.findSessionSnapshots({
      machineId,
      agentId,
      limit: this.minSessions + 1,
    });

    const recentSessions = sessions.filter(
      (s) => !s.lastActivityAt || s.lastActivityAt > since,
    );

    return recentSessions.length >= this.minSessions;
  }
}
