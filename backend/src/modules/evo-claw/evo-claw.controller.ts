import { ChatAnthropic } from '@langchain/anthropic';
import { createChildLogger } from '../../shared/logger.js';
import type { EvoClawRepository } from './evo-claw.repository.js';
import type {
  EvoRule,
  EvoCase,
  ConflictCheckResult,
  CompressionResult,
  DistilledRule,
  DistilledCase,
} from './evo-claw.types.js';

const log = createChildLogger('evo-controller');

const CONFLICT_CHECK_PROMPT = `You are a rule conflict detector for an AI assistant system.

Given a NEW rule and a list of EXISTING rules (all targeting the same config file),
determine if the new rule contradicts any existing rule.

## Output Format (JSON)

{
  "hasConflict": true/false,
  "conflictingRuleIndex": null or index of the conflicting existing rule,
  "resolution": "none" | "merge" | "supersede",
  "mergedContent": "merged rule text if resolution is merge, otherwise null",
  "reason": "brief explanation"
}

- "merge": Both rules have valid aspects; combine into one coherent rule.
- "supersede": The new rule completely replaces the old one.
- "none": No conflict found.

Respond ONLY with valid JSON, no markdown fencing.`;

const COMPRESSION_PROMPT = `You are a rule compressor for an AI assistant system.

Given a list of fine-grained behavior rules, merge them into fewer high-level principles
while preserving all essential guidance. Target roughly 1/3 of the original count.

## Output Format (JSON array)

[
  {
    "ruleKey": "compressed-rule-slug",
    "content": "The compressed rule text",
    "mergedFromIndices": [0, 2, 5]
  }
]

mergedFromIndices references the indices of the input rules that were merged into this one.
Respond ONLY with a valid JSON array, no markdown fencing.`;

const CASE_SIMILARITY_PROMPT = `You are a case similarity checker for an AI assistant system.

Given a NEW case and an EXISTING case, determine if they describe essentially the same scenario
and should be merged.

## Output Format (JSON)

{
  "isSimilar": true/false,
  "reason": "brief explanation",
  "mergedApproach": "combined correct_approach if similar, otherwise null"
}

Respond ONLY with valid JSON, no markdown fencing.`;

export class EvoClawController {
  private model: ChatAnthropic;
  private repo: EvoClawRepository;
  private maxRulesPerFile: number;
  private decayThresholdRuns: number;

  constructor(
    modelName: string,
    repo: EvoClawRepository,
    opts: { maxRulesPerFile: number; decayThresholdRuns: number },
  ) {
    this.model = new ChatAnthropic({ model: modelName, maxTokens: 4096, temperature: 0 });
    this.repo = repo;
    this.maxRulesPerFile = opts.maxRulesPerFile;
    this.decayThresholdRuns = opts.decayThresholdRuns;
  }

  async checkConflict(
    newRule: DistilledRule,
    existingRules: EvoRule[],
  ): Promise<ConflictCheckResult> {
    if (existingRules.length === 0) {
      return { hasConflict: false, resolution: 'none' };
    }

    const existingList = existingRules.map((r, i) =>
      `[${i}] (key: ${r.ruleKey}) ${r.content}`
    ).join('\n');

    const userPrompt = [
      '## New Rule',
      `(key: ${newRule.ruleKey}) ${newRule.content}`,
      '',
      `## Existing Rules (${existingRules.length})`,
      existingList,
    ].join('\n');

    try {
      const response = await this.model.invoke([
        { role: 'system', content: CONFLICT_CHECK_PROMPT },
        { role: 'user', content: userPrompt },
      ]);

      const text = typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);
      const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      const parsed = JSON.parse(cleaned) as Record<string, unknown>;

      const conflictIdx = parsed.conflictingRuleIndex as number | null;
      return {
        hasConflict: Boolean(parsed.hasConflict),
        conflictingRuleId: conflictIdx != null ? existingRules[conflictIdx]?.id : undefined,
        resolution: (parsed.resolution as ConflictCheckResult['resolution']) ?? 'none',
        mergedContent: parsed.mergedContent as string | undefined,
      };
    } catch (err) {
      log.error({ err }, 'Conflict check failed, assuming no conflict');
      return { hasConflict: false, resolution: 'none' };
    }
  }

  async compressRules(
    machineId: string,
    agentId: string,
    targetFile: string,
  ): Promise<CompressionResult | null> {
    const rules = await this.repo.findActiveRulesByFile(machineId, agentId, targetFile);
    if (rules.length <= this.maxRulesPerFile) return null;

    log.info(
      { machineId, agentId, targetFile, count: rules.length },
      'Compressing rules (exceeds max)',
    );

    const rulesList = rules.map((r, i) =>
      `[${i}] (key: ${r.ruleKey}, type: ${r.ruleType}) ${r.content}`
    ).join('\n');

    try {
      const response = await this.model.invoke([
        { role: 'system', content: COMPRESSION_PROMPT },
        { role: 'user', content: `Compress these ${rules.length} rules:\n\n${rulesList}` },
      ]);

      const text = typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);
      const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      const parsed = JSON.parse(cleaned) as Array<Record<string, unknown>>;

      if (!Array.isArray(parsed)) return null;

      return {
        originalCount: rules.length,
        compressedRules: parsed.map((item) => ({
          ruleKey: (item.ruleKey as string) ?? `compressed-${Date.now()}`,
          content: (item.content as string) ?? '',
          mergedFromIds: ((item.mergedFromIndices as number[]) ?? [])
            .map((i) => rules[i]?.id)
            .filter(Boolean),
        })),
      };
    } catch (err) {
      log.error({ err }, 'Rule compression failed');
      return null;
    }
  }

  async checkCaseSimilarity(
    newCase: DistilledCase,
    existingCases: EvoCase[],
  ): Promise<{ similarCaseId?: number; mergedApproach?: string }> {
    for (const existing of existingCases) {
      const userPrompt = [
        '## New Case',
        `Scenario: ${newCase.scenario}`,
        `Correct Approach: ${newCase.correctApproach}`,
        '',
        '## Existing Case',
        `Scenario: ${existing.scenario}`,
        `Correct Approach: ${existing.correctApproach}`,
      ].join('\n');

      try {
        const response = await this.model.invoke([
          { role: 'system', content: CASE_SIMILARITY_PROMPT },
          { role: 'user', content: userPrompt },
        ]);

        const text = typeof response.content === 'string'
          ? response.content
          : JSON.stringify(response.content);
        const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
        const parsed = JSON.parse(cleaned) as Record<string, unknown>;

        if (parsed.isSimilar) {
          return {
            similarCaseId: existing.id,
            mergedApproach: (parsed.mergedApproach as string) ?? existing.correctApproach,
          };
        }
      } catch (err) {
        log.warn({ err, existingCaseId: existing.id }, 'Case similarity check failed');
      }
    }
    return {};
  }

  async runDecay(machineId: string, agentId: string): Promise<number> {
    const activeRules = await this.repo.findActiveRulesForAgent(machineId, agentId);
    let deprecatedCount = 0;

    for (const rule of activeRules) {
      const runsSinceCreated = await this.repo.countRunsSinceRuleCreated(rule.id);

      const neverTriggered = rule.triggerCount === 0 && runsSinceCreated >= this.decayThresholdRuns;
      const netNegative = rule.negativeFeedbackCount > rule.positiveFeedbackCount
        && (rule.positiveFeedbackCount + rule.negativeFeedbackCount) >= 3;

      if (neverTriggered || netNegative) {
        log.info(
          { ruleId: rule.id, ruleKey: rule.ruleKey, neverTriggered, netNegative },
          'Decaying rule',
        );
        await this.repo.deprecateRule(rule.id);
        deprecatedCount++;
      }
    }

    return deprecatedCount;
  }
}
