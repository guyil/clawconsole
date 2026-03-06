import { describe, it, expect } from 'vitest';
import { validateWorkflow } from '../../../src/modules/workflows/workflow.validator.js';
import type {
  SkillNodeDef,
  ReviewNodeDef,
  ConditionNodeDef,
  WorkflowEdgeDef,
} from '../../../src/modules/workflows/workflow.types.js';

function skillNode(overrides: Partial<SkillNodeDef> = {}): SkillNodeDef {
  return {
    id: 'skill-1',
    type: 'skill',
    name: 'Test Skill',
    skillRef: 'content-writer',
    input: {},
    output: 'skill_result',
    ...overrides,
  };
}

function reviewNode(overrides: Partial<ReviewNodeDef> = {}): ReviewNodeDef {
  return {
    id: 'review-1',
    type: 'review',
    name: 'Manager Review',
    reviewers: [{ role: 'manager' }],
    policy: 'any',
    ...overrides,
  };
}

function conditionNode(overrides: Partial<ConditionNodeDef> = {}): ConditionNodeDef {
  return {
    id: 'condition-1',
    type: 'condition',
    name: 'Quality Gate',
    expression: '{{ nodes.skill-1.output.score > 0.8 }}',
    branches: [
      { condition: 'true', target: 'publish' },
      { condition: 'false', target: 'revise' },
    ],
    ...overrides,
  };
}

describe('validateWorkflow', () => {
  describe('empty workflow', () => {
    it('returns error for empty nodes', () => {
      const result = validateWorkflow([], []);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({ type: 'EMPTY_WORKFLOW' }),
      );
    });
  });

  describe('single node', () => {
    it('validates a single skill node', () => {
      const result = validateWorkflow([skillNode()], []);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('valid linear workflow', () => {
    it('validates a simple linear DAG', () => {
      const nodes = [
        skillNode({ id: 'draft', output: 'draft_result' }),
        reviewNode({ id: 'review' }),
        skillNode({ id: 'publish', skillRef: 'publisher', output: 'publish_result' }),
      ];
      const edges: WorkflowEdgeDef[] = [
        { source: 'draft', target: 'review' },
        { source: 'review', target: 'publish' },
      ];

      const result = validateWorkflow(nodes, edges);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('valid branching workflow', () => {
    it('validates a workflow with condition branches', () => {
      const nodes = [
        skillNode({ id: 'draft', output: 'draft_result' }),
        conditionNode({
          id: 'gate',
          branches: [
            { condition: 'true', target: 'publish' },
            { condition: 'false', target: 'revise' },
          ],
        }),
        skillNode({ id: 'publish', skillRef: 'publisher', output: 'pub_result' }),
        skillNode({ id: 'revise', skillRef: 'reviser', output: 'rev_result' }),
      ];
      const edges: WorkflowEdgeDef[] = [
        { source: 'draft', target: 'gate' },
        { source: 'gate', target: 'publish', condition: 'true' },
        { source: 'gate', target: 'revise', condition: 'false' },
      ];

      const result = validateWorkflow(nodes, edges);
      expect(result.valid).toBe(true);
    });
  });

  describe('duplicate node IDs', () => {
    it('detects duplicate node IDs', () => {
      const nodes = [
        skillNode({ id: 'dup', output: 'result1' }),
        skillNode({ id: 'dup', output: 'result2' }),
      ];
      const result = validateWorkflow(nodes, []);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({ type: 'DUPLICATE_NODE_ID', nodeId: 'dup' }),
      );
    });
  });

  describe('invalid edge references', () => {
    it('detects edge source that does not exist', () => {
      const nodes = [skillNode({ id: 'a', output: 'a_result' })];
      const edges: WorkflowEdgeDef[] = [
        { source: 'nonexistent', target: 'a' },
      ];

      const result = validateWorkflow(nodes, edges);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({ type: 'INVALID_EDGE_SOURCE' }),
      );
    });

    it('detects edge target that does not exist', () => {
      const nodes = [skillNode({ id: 'a', output: 'a_result' })];
      const edges: WorkflowEdgeDef[] = [
        { source: 'a', target: 'nonexistent' },
      ];

      const result = validateWorkflow(nodes, edges);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({ type: 'INVALID_EDGE_TARGET' }),
      );
    });
  });

  describe('orphan nodes', () => {
    it('detects nodes with no connections', () => {
      const nodes = [
        skillNode({ id: 'a', output: 'a_result' }),
        skillNode({ id: 'orphan', output: 'orphan_result' }),
      ];
      const edges: WorkflowEdgeDef[] = [];

      const result = validateWorkflow(nodes, edges);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({ type: 'ORPHAN_NODE', nodeId: 'a' }),
      );
      expect(result.errors).toContainEqual(
        expect.objectContaining({ type: 'ORPHAN_NODE', nodeId: 'orphan' }),
      );
    });
  });

  describe('cycle detection', () => {
    it('detects a simple cycle', () => {
      const nodes = [
        skillNode({ id: 'a', output: 'a_result' }),
        skillNode({ id: 'b', skillRef: 'other', output: 'b_result' }),
      ];
      const edges: WorkflowEdgeDef[] = [
        { source: 'a', target: 'b' },
        { source: 'b', target: 'a' },
      ];

      const result = validateWorkflow(nodes, edges);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.type === 'CYCLE_DETECTED')).toBe(true);
    });

    it('detects a three-node cycle', () => {
      const nodes = [
        skillNode({ id: 'a', output: 'a_result' }),
        skillNode({ id: 'b', skillRef: 'other', output: 'b_result' }),
        skillNode({ id: 'c', skillRef: 'third', output: 'c_result' }),
      ];
      const edges: WorkflowEdgeDef[] = [
        { source: 'a', target: 'b' },
        { source: 'b', target: 'c' },
        { source: 'c', target: 'a' },
      ];

      const result = validateWorkflow(nodes, edges);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.type === 'CYCLE_DETECTED')).toBe(true);
    });
  });

  describe('skill node validation', () => {
    it('detects missing skillRef', () => {
      const nodes = [skillNode({ id: 'a', skillRef: '', output: 'a_result' })];
      const result = validateWorkflow(nodes, []);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({ type: 'MISSING_SKILL_REF', nodeId: 'a' }),
      );
    });

    it('detects missing output key', () => {
      const nodes = [skillNode({ id: 'a', output: '' })];
      const result = validateWorkflow(nodes, []);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({ type: 'MISSING_OUTPUT', nodeId: 'a' }),
      );
    });

    it('detects unapproved skill when approvedSkillKeys provided', () => {
      const approvedSkillKeys = new Set(['approved-skill']);
      const nodes = [skillNode({ id: 'a', skillRef: 'unapproved-skill', output: 'a_result' })];

      const result = validateWorkflow(nodes, [], approvedSkillKeys);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({ type: 'MISSING_SKILL', nodeId: 'a' }),
      );
    });

    it('passes when skill is approved', () => {
      const approvedSkillKeys = new Set(['content-writer']);
      const nodes = [skillNode({ id: 'a', output: 'a_result' })];

      const result = validateWorkflow(nodes, [], approvedSkillKeys);
      expect(result.valid).toBe(true);
    });
  });

  describe('review node validation', () => {
    it('detects missing reviewers', () => {
      const nodes = [reviewNode({ id: 'r', reviewers: [] })];
      const result = validateWorkflow(nodes, []);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({ type: 'NO_REVIEWERS', nodeId: 'r' }),
      );
    });

    it('warns about missing timeout', () => {
      const nodes = [reviewNode({ id: 'r' })];
      const result = validateWorkflow(nodes, []);
      expect(result.valid).toBe(true);
      expect(result.warnings).toContainEqual(
        expect.objectContaining({ type: 'NO_TIMEOUT', nodeId: 'r' }),
      );
    });

    it('no warning when timeout is set', () => {
      const nodes = [reviewNode({ id: 'r', timeout: '2h' })];
      const result = validateWorkflow(nodes, []);
      expect(result.warnings.filter((w) => w.type === 'NO_TIMEOUT')).toHaveLength(0);
    });
  });

  describe('condition node validation', () => {
    it('detects missing expression', () => {
      const nodes = [conditionNode({ id: 'c', expression: '' })];
      const result = validateWorkflow(nodes, []);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({ type: 'MISSING_EXPRESSION', nodeId: 'c' }),
      );
    });

    it('detects missing branches', () => {
      const nodes = [conditionNode({ id: 'c', branches: [] })];
      const result = validateWorkflow(nodes, []);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({ type: 'NO_BRANCHES', nodeId: 'c' }),
      );
    });

    it('detects invalid branch target', () => {
      const nodes = [conditionNode({
        id: 'c',
        branches: [{ condition: 'true', target: 'nonexistent' }],
      })];
      const result = validateWorkflow(nodes, []);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({ type: 'INVALID_BRANCH_TARGET', nodeId: 'c' }),
      );
    });
  });

  describe('duplicate output keys', () => {
    it('detects duplicate output keys across skill nodes', () => {
      const nodes = [
        skillNode({ id: 'a', output: 'same_key' }),
        skillNode({ id: 'b', skillRef: 'other', output: 'same_key' }),
      ];
      const edges: WorkflowEdgeDef[] = [{ source: 'a', target: 'b' }];

      const result = validateWorkflow(nodes, edges);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({ type: 'DUPLICATE_OUTPUT_KEY' }),
      );
    });
  });

  describe('complex valid workflow', () => {
    it('validates a full content-pipeline workflow', () => {
      const approvedSkillKeys = new Set([
        'content-writer',
        'seo-optimizer',
        'content-publisher',
        'content-reviser',
      ]);

      const nodes = [
        skillNode({ id: 'draft', skillRef: 'content-writer', output: 'draft_result' }),
        skillNode({ id: 'seo', skillRef: 'seo-optimizer', output: 'seo_result' }),
        reviewNode({ id: 'review', timeout: '2h' }),
        conditionNode({
          id: 'gate',
          branches: [
            { condition: 'true', target: 'publish' },
            { condition: 'false', target: 'revise' },
          ],
        }),
        skillNode({ id: 'publish', skillRef: 'content-publisher', output: 'pub_result' }),
        skillNode({ id: 'revise', skillRef: 'content-reviser', output: 'rev_result' }),
      ];

      const edges: WorkflowEdgeDef[] = [
        { source: 'draft', target: 'seo' },
        { source: 'seo', target: 'review' },
        { source: 'review', target: 'gate' },
        { source: 'gate', target: 'publish' },
        { source: 'gate', target: 'revise' },
      ];

      const result = validateWorkflow(nodes, edges, approvedSkillKeys);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });
  });
});
