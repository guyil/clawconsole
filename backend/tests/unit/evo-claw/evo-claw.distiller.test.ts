import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { EvoSignal } from '../../../src/modules/evo-claw/evo-claw.types.js';

const mockInvoke = vi.fn();

vi.mock('@langchain/anthropic', () => ({
  ChatAnthropic: class {
    constructor() {}
    invoke = mockInvoke;
  },
}));

const { EvoClawDistiller } = await import('../../../src/modules/evo-claw/evo-claw.distiller.js');

function makeSignal(overrides?: Partial<EvoSignal>): EvoSignal {
  return {
    id: 1,
    machineId: 'm1',
    agentId: 'pm',
    evoRunId: 1,
    signalType: 'evaluative',
    polarity: 'negative',
    sourceSessionId: 'sess-1',
    messageIndexStart: 0,
    messageIndexEnd: 2,
    rawContent: '[user]: What is the cap?\n[assistant]: 100%.\n[user follow-up]: Wrong.',
    hint: null,
    classificationReason: 'User corrected the bot',
    processed: false,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('EvoClawDistiller', () => {
  let distiller: InstanceType<typeof EvoClawDistiller>;

  beforeEach(() => {
    mockInvoke.mockReset();
    distiller = new EvoClawDistiller('claude-sonnet-4-20250514');
  });

  describe('distillRules', () => {
    it('distills rules from negative signals', async () => {
      mockInvoke.mockResolvedValueOnce({
        content: JSON.stringify([
          {
            ruleKey: 'anchor-compensation-to-convention',
            ruleType: 'constraint',
            content: 'Always anchor compensation suggestions to industry conventions',
            targetFile: 'SOUL.md',
            targetSection: 'Behavior Constraints',
            confidenceScore: 0.9,
            sourceIndices: [0],
          },
        ]),
      });

      const rules = await distiller.distillRules([makeSignal()]);

      expect(rules).toHaveLength(1);
      expect(rules[0].ruleKey).toBe('anchor-compensation-to-convention');
      expect(rules[0].targetFile).toBe('SOUL.md');
      expect(rules[0].confidenceScore).toBe(0.9);
      expect(rules[0].sourceSignalIds).toContain(1);
    });

    it('returns empty array for no signals', async () => {
      const rules = await distiller.distillRules([]);
      expect(rules).toHaveLength(0);
    });

    it('handles API errors gracefully', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('API error'));

      const rules = await distiller.distillRules([makeSignal()]);
      expect(rules).toHaveLength(0);
    });

    it('defaults invalid targetFile to SOUL.md', async () => {
      mockInvoke.mockResolvedValueOnce({
        content: JSON.stringify([
          {
            ruleKey: 'test-rule',
            ruleType: 'preference',
            content: 'Test rule content',
            targetFile: 'INVALID.md',
            targetSection: 'Test',
            confidenceScore: 0.5,
            sourceIndices: [0],
          },
        ]),
      });

      const rules = await distiller.distillRules([makeSignal()]);
      expect(rules[0].targetFile).toBe('SOUL.md');
    });
  });

  describe('distillCase', () => {
    it('distills a case from an instructive signal', async () => {
      mockInvoke.mockResolvedValueOnce({
        content: JSON.stringify({
          caseKey: 'compensation-cap-review',
          scenario: 'Reviewing compensation cap in supplier contract',
          userQuestionSummary: 'What should the compensation cap be?',
          botWrongAnswerSummary: 'Suggested 100% of contract value',
          userCorrection: 'Industry standard is 6-12 months of service fees',
          correctApproach: 'Check convention first, then provide range',
        }),
      });

      const signal = makeSignal({ signalType: 'instructive', hint: 'Use industry conventions' });
      const result = await distiller.distillCase(signal);

      expect(result).not.toBeNull();
      expect(result!.caseKey).toBe('compensation-cap-review');
      expect(result!.sourceSignalIds).toContain(signal.id);
    });

    it('handles parse errors gracefully', async () => {
      mockInvoke.mockResolvedValueOnce({ content: 'not json' });

      const result = await distiller.distillCase(makeSignal());
      expect(result).toBeNull();
    });
  });
});
