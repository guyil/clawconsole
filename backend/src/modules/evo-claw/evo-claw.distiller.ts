import { ChatAnthropic } from '@langchain/anthropic';
import { createChildLogger } from '../../shared/logger.js';
import type { EvoSignal, DistilledRule, DistilledCase, EvoTargetFile } from './evo-claw.types.js';

const log = createChildLogger('evo-distiller');

const RULE_DISTILL_PROMPT = `You are a behavior rule distiller for an AI assistant system.

Given a batch of negative feedback signals (conversations where the bot performed poorly),
identify recurring failure patterns and distill them into concise, actionable behavior rules.

## Rules for Rule Generation

1. Each rule must be a single, clear, actionable directive.
2. Rules should be general enough to apply beyond the specific case, but specific enough to be useful.
3. Determine the target file based on the rule's nature:
   - SOUL.md: General behavior constraints, communication style, decision-making approaches
   - TOOLS.md: Tool usage patterns, when to use specific tools, tool parameter guidance
   - AGENTS.md: Multi-agent collaboration rules, delegation patterns
4. Group rules by section within the target file.
5. Assign a confidence score (0-1) based on how clear and recurring the pattern is.
6. Generate a unique rule_key slug (lowercase, hyphens, e.g. "anchor-compensation-to-convention").

## Output Format (JSON array)

[
  {
    "ruleKey": "slug-for-this-rule",
    "ruleType": "constraint" | "preference" | "procedure",
    "content": "The rule text in natural language",
    "targetFile": "SOUL.md" | "TOOLS.md" | "AGENTS.md",
    "targetSection": "Section name within the file",
    "confidenceScore": 0.85,
    "sourceIndices": [0, 2]
  }
]

sourceIndices references the indices of the input signals array that led to this rule.
Respond ONLY with a valid JSON array, no markdown fencing.`;

const CASE_DISTILL_PROMPT = `You are a case example generator for an AI assistant system.

Given an instructive feedback signal (where a user corrected the bot with specific guidance),
generate a structured case example that the bot can reference in future similar situations.

## Output Format (JSON)

{
  "caseKey": "slug-for-this-case",
  "scenario": "Brief description of the scenario",
  "userQuestionSummary": "What the user asked",
  "botWrongAnswerSummary": "What the bot did wrong",
  "userCorrection": "What the user said to correct",
  "correctApproach": "The correct step-by-step approach"
}

Respond ONLY with valid JSON, no markdown fencing.`;

export class EvoClawDistiller {
  private model: ChatAnthropic;

  constructor(modelName: string) {
    this.model = new ChatAnthropic({
      model: modelName,
      maxTokens: 4096,
      temperature: 0,
    });
  }

  async distillRules(signals: EvoSignal[]): Promise<DistilledRule[]> {
    if (signals.length === 0) return [];

    const signalDescriptions = signals.map((s, i) => [
      `--- Signal ${i} (session: ${s.sourceSessionId}) ---`,
      s.rawContent,
      s.classificationReason ? `Judge reasoning: ${s.classificationReason}` : '',
    ].filter(Boolean).join('\n')).join('\n\n');

    try {
      const response = await this.model.invoke([
        { role: 'system', content: RULE_DISTILL_PROMPT },
        { role: 'user', content: `Here are ${signals.length} negative feedback signals:\n\n${signalDescriptions}` },
      ]);

      const text = typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);

      return this.parseRules(text, signals);
    } catch (err) {
      log.error({ err, signalCount: signals.length }, 'Rule distillation failed');
      return [];
    }
  }

  async distillCase(signal: EvoSignal): Promise<DistilledCase | null> {
    const userPrompt = [
      '## Conversation Segment',
      signal.rawContent,
      '',
      signal.hint ? `## User\'s Directional Hint\n${signal.hint}` : '',
    ].filter(Boolean).join('\n');

    try {
      const response = await this.model.invoke([
        { role: 'system', content: CASE_DISTILL_PROMPT },
        { role: 'user', content: userPrompt },
      ]);

      const text = typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);

      return this.parseCase(text, signal);
    } catch (err) {
      log.error({ err, signalId: signal.id }, 'Case distillation failed');
      return null;
    }
  }

  async distillCases(signals: EvoSignal[]): Promise<DistilledCase[]> {
    const cases: DistilledCase[] = [];
    for (const signal of signals) {
      const c = await this.distillCase(signal);
      if (c) cases.push(c);
    }
    return cases;
  }

  private parseRules(text: string, signals: EvoSignal[]): DistilledRule[] {
    try {
      const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      const parsed = JSON.parse(cleaned) as Array<Record<string, unknown>>;
      if (!Array.isArray(parsed)) return [];

      return parsed.map((item) => {
        const sourceIndices = (item.sourceIndices as number[]) ?? [];
        return {
          ruleKey: (item.ruleKey as string) ?? `rule-${Date.now()}`,
          ruleType: (item.ruleType as DistilledRule['ruleType']) ?? 'constraint',
          content: (item.content as string) ?? '',
          targetFile: this.validateTargetFile(item.targetFile as string),
          targetSection: (item.targetSection as string) ?? 'Auto-evolved Rules',
          confidenceScore: Number(item.confidenceScore ?? 0.5),
          sourceSignalIds: sourceIndices.map((i) => signals[i]?.id).filter(Boolean),
        };
      }).filter((r) => r.content.length > 0);
    } catch (err) {
      log.warn({ err, text: text.slice(0, 200) }, 'Failed to parse distilled rules');
      return [];
    }
  }

  private parseCase(text: string, signal: EvoSignal): DistilledCase | null {
    try {
      const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      const parsed = JSON.parse(cleaned) as Record<string, unknown>;
      return {
        caseKey: (parsed.caseKey as string) ?? `case-${Date.now()}`,
        scenario: (parsed.scenario as string) ?? '',
        userQuestionSummary: (parsed.userQuestionSummary as string) ?? '',
        botWrongAnswerSummary: (parsed.botWrongAnswerSummary as string) ?? '',
        userCorrection: (parsed.userCorrection as string) ?? '',
        correctApproach: (parsed.correctApproach as string) ?? '',
        sourceSignalIds: [signal.id],
      };
    } catch (err) {
      log.warn({ err, text: text.slice(0, 200) }, 'Failed to parse distilled case');
      return null;
    }
  }

  private validateTargetFile(file: string): EvoTargetFile {
    const valid: EvoTargetFile[] = ['SOUL.md', 'TOOLS.md', 'AGENTS.md'];
    return valid.includes(file as EvoTargetFile) ? (file as EvoTargetFile) : 'SOUL.md';
  }
}
