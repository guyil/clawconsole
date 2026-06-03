import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { EvoClawRepository } from '../../../src/modules/evo-claw/evo-claw.repository.js';
import type { EvoRule, EvoCase, DistilledRule, DistilledCase } from '../../../src/modules/evo-claw/evo-claw.types.js';

const mockInvoke = vi.fn();

vi.mock('@langchain/anthropic', () => ({
  ChatAnthropic: class {
    constructor() {}
    invoke = mockInvoke;
  },
}));

const { EvoClawController } = await import('../../../src/modules/evo-claw/evo-claw.controller.js');

function makeRule(overrides?: Partial<EvoRule>): EvoRule {
  return {
    id: 1,
    machineId: 'm1',
    agentId: 'pm',
    evoRunId: 1,
    ruleKey: 'existing-rule',
    ruleType: 'constraint',
    content: 'Always reference industry data',
    targetFile: 'SOUL.md',
    targetSection: 'Constraints',
    sourceSignalIds: [1],
    status: 'active',
    confidenceScore: 0.8,
    triggerCount: 5,
    positiveFeedbackCount: 3,
    negativeFeedbackCount: 1,
    mergedIntoId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    deprecatedAt: null,
    ...overrides,
  };
}

function makeDistilledRule(overrides?: Partial<DistilledRule>): DistilledRule {
  return {
    ruleKey: 'new-rule',
    ruleType: 'constraint',
    content: 'Never give absolute numbers',
    targetFile: 'SOUL.md',
    targetSection: 'Constraints',
    confidenceScore: 0.85,
    sourceSignalIds: [2],
    ...overrides,
  };
}

function makeCase(overrides?: Partial<EvoCase>): EvoCase {
  return {
    id: 1,
    machineId: 'm1',
    agentId: 'pm',
    evoRunId: 1,
    caseKey: 'case-1',
    scenario: 'Contract cap review',
    userQuestionSummary: 'What is the cap?',
    botWrongAnswerSummary: 'Suggested 100%',
    userCorrection: 'Should be 6-12 months',
    correctApproach: 'Check conventions first',
    sourceSignalIds: [1],
    status: 'active',
    relevanceCount: 3,
    mergedIntoId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('EvoClawController', () => {
  let controller: InstanceType<typeof EvoClawController>;
  let mockRepo: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    mockInvoke.mockReset();

    mockRepo = {
      findActiveRulesByFile: vi.fn().mockResolvedValue([]),
      findActiveRulesForAgent: vi.fn().mockResolvedValue([]),
      deprecateRule: vi.fn().mockResolvedValue(undefined),
      countRunsSinceRuleCreated: vi.fn().mockResolvedValue(0),
    };

    controller = new EvoClawController(
      'claude-sonnet-4-20250514',
      mockRepo as unknown as EvoClawRepository,
      { maxRulesPerFile: 5, decayThresholdRuns: 3 },
    );
  });

  describe('checkConflict', () => {
    it('returns no conflict when no existing rules', async () => {
      const result = await controller.checkConflict(makeDistilledRule(), []);
      expect(result.hasConflict).toBe(false);
      expect(result.resolution).toBe('none');
    });

    it('detects conflict and suggests merge', async () => {
      mockInvoke.mockResolvedValueOnce({
        content: JSON.stringify({
          hasConflict: true,
          conflictingRuleIndex: 0,
          resolution: 'merge',
          mergedContent: 'Always reference industry data and provide ranges, not absolutes',
          reason: 'Both rules address data-driven responses',
        }),
      });

      const result = await controller.checkConflict(makeDistilledRule(), [makeRule()]);

      expect(result.hasConflict).toBe(true);
      expect(result.resolution).toBe('merge');
      expect(result.mergedContent).toContain('industry data');
      expect(result.conflictingRuleId).toBe(1);
    });

    it('handles API errors gracefully', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('API down'));

      const result = await controller.checkConflict(makeDistilledRule(), [makeRule()]);
      expect(result.hasConflict).toBe(false);
    });
  });

  describe('compressRules', () => {
    it('skips compression when under threshold', async () => {
      mockRepo.findActiveRulesByFile.mockResolvedValueOnce([
        makeRule(), makeRule({ id: 2, ruleKey: 'rule-2' }),
      ]);

      const result = await controller.compressRules('m1', 'pm', 'SOUL.md');
      expect(result).toBeNull();
    });

    it('compresses when over threshold', async () => {
      const manyRules = Array.from({ length: 6 }, (_, i) =>
        makeRule({ id: i + 1, ruleKey: `rule-${i}`, content: `Rule ${i}` }),
      );
      mockRepo.findActiveRulesByFile.mockResolvedValueOnce(manyRules);

      mockInvoke.mockResolvedValueOnce({
        content: JSON.stringify([
          { ruleKey: 'compressed-1', content: 'Data-driven approaches', mergedFromIndices: [0, 1, 2] },
          { ruleKey: 'compressed-2', content: 'Ranges over absolutes', mergedFromIndices: [3, 4, 5] },
        ]),
      });

      const result = await controller.compressRules('m1', 'pm', 'SOUL.md');

      expect(result).not.toBeNull();
      expect(result!.originalCount).toBe(6);
      expect(result!.compressedRules).toHaveLength(2);
    });
  });

  describe('runDecay', () => {
    it('deprecates rules that were never triggered after threshold runs', async () => {
      const staleRule = makeRule({ triggerCount: 0, positiveFeedbackCount: 0, negativeFeedbackCount: 0 });
      mockRepo.findActiveRulesForAgent.mockResolvedValueOnce([staleRule]);
      mockRepo.countRunsSinceRuleCreated.mockResolvedValueOnce(5);

      const count = await controller.runDecay('m1', 'pm');

      expect(count).toBe(1);
      expect(mockRepo.deprecateRule).toHaveBeenCalledWith(staleRule.id);
    });

    it('deprecates rules with net negative feedback', async () => {
      const badRule = makeRule({ triggerCount: 10, positiveFeedbackCount: 1, negativeFeedbackCount: 3 });
      mockRepo.findActiveRulesForAgent.mockResolvedValueOnce([badRule]);
      mockRepo.countRunsSinceRuleCreated.mockResolvedValueOnce(1);

      const count = await controller.runDecay('m1', 'pm');

      expect(count).toBe(1);
      expect(mockRepo.deprecateRule).toHaveBeenCalledWith(badRule.id);
    });

    it('keeps healthy rules', async () => {
      const goodRule = makeRule({ triggerCount: 10, positiveFeedbackCount: 8, negativeFeedbackCount: 1 });
      mockRepo.findActiveRulesForAgent.mockResolvedValueOnce([goodRule]);
      mockRepo.countRunsSinceRuleCreated.mockResolvedValueOnce(5);

      const count = await controller.runDecay('m1', 'pm');

      expect(count).toBe(0);
      expect(mockRepo.deprecateRule).not.toHaveBeenCalled();
    });
  });

  describe('checkCaseSimilarity', () => {
    it('identifies similar cases', async () => {
      mockInvoke.mockResolvedValueOnce({
        content: JSON.stringify({
          isSimilar: true,
          reason: 'Both about compensation caps',
          mergedApproach: 'Combined approach text',
        }),
      });

      const newCase: DistilledCase = {
        caseKey: 'new-case',
        scenario: 'Compensation cap negotiation',
        userQuestionSummary: 'About caps',
        botWrongAnswerSummary: 'Bad advice',
        userCorrection: 'Better way',
        correctApproach: 'Check conventions',
        sourceSignalIds: [5],
      };

      const result = await controller.checkCaseSimilarity(newCase, [makeCase()]);

      expect(result.similarCaseId).toBe(1);
      expect(result.mergedApproach).toBe('Combined approach text');
    });

    it('returns empty when no similar cases', async () => {
      mockInvoke.mockResolvedValueOnce({
        content: JSON.stringify({ isSimilar: false, reason: 'Different topics' }),
      });

      const newCase: DistilledCase = {
        caseKey: 'unrelated',
        scenario: 'Unrelated topic',
        userQuestionSummary: 'Different question',
        botWrongAnswerSummary: 'Different error',
        userCorrection: 'Different correction',
        correctApproach: 'Different approach',
        sourceSignalIds: [5],
      };

      const result = await controller.checkCaseSimilarity(newCase, [makeCase()]);
      expect(result.similarCaseId).toBeUndefined();
    });
  });
});
