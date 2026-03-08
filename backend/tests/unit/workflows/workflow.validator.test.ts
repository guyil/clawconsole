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
    command: 'exec --json --shell "python run.py"',
    ...overrides,
  };
}

function reviewNode(overrides: Partial<ReviewNodeDef> = {}): ReviewNodeDef {
  return {
    id: 'review-1',
    type: 'review',
    name: 'Manager Approval',
    ...overrides,
  };
}

function conditionNode(overrides: Partial<ConditionNodeDef> = {}): ConditionNodeDef {
  return {
    id: 'condition-1',
    type: 'condition',
    name: 'Quality Gate',
    expression: '$skill-1.passed',
    branches: [
      { condition: '== true', target: 'publish' },
      { condition: '== false', target: 'revise' },
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

    it('validates a single review node (no config required)', () => {
      const result = validateWorkflow([reviewNode()], []);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('valid linear workflow', () => {
    it('validates a simple linear DAG', () => {
      const nodes = [
        skillNode({ id: 'draft' }),
        reviewNode({ id: 'review' }),
        skillNode({ id: 'publish', command: 'publish --final' }),
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
        skillNode({ id: 'draft' }),
        conditionNode({
          id: 'gate',
          branches: [
            { condition: '== true', target: 'publish' },
            { condition: '== false', target: 'revise' },
          ],
        }),
        skillNode({ id: 'publish', command: 'publish' }),
        skillNode({ id: 'revise', command: 'revise' }),
      ];
      const edges: WorkflowEdgeDef[] = [
        { source: 'draft', target: 'gate' },
        { source: 'gate', target: 'publish', condition: '== true' },
        { source: 'gate', target: 'revise', condition: '== false' },
      ];

      const result = validateWorkflow(nodes, edges);
      expect(result.valid).toBe(true);
    });
  });

  describe('duplicate node IDs', () => {
    it('detects duplicate node IDs', () => {
      const nodes = [
        skillNode({ id: 'dup' }),
        skillNode({ id: 'dup', command: 'other' }),
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
      const nodes = [skillNode({ id: 'a' })];
      const edges: WorkflowEdgeDef[] = [{ source: 'nonexistent', target: 'a' }];

      const result = validateWorkflow(nodes, edges);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({ type: 'INVALID_EDGE_SOURCE' }),
      );
    });

    it('detects edge target that does not exist', () => {
      const nodes = [skillNode({ id: 'a' })];
      const edges: WorkflowEdgeDef[] = [{ source: 'a', target: 'nonexistent' }];

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
        skillNode({ id: 'a' }),
        skillNode({ id: 'orphan', command: 'orphan' }),
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
        skillNode({ id: 'a' }),
        skillNode({ id: 'b', command: 'other' }),
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
        skillNode({ id: 'a' }),
        skillNode({ id: 'b', command: 'b' }),
        skillNode({ id: 'c', command: 'c' }),
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
    it('detects missing command', () => {
      const nodes = [skillNode({ id: 'a', command: '' })];
      const result = validateWorkflow(nodes, []);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({ type: 'MISSING_COMMAND', nodeId: 'a' }),
      );
    });

    it('warns about unresolved skillRef', () => {
      const approvedSkillKeys = new Set(['approved-skill']);
      const nodes = [skillNode({ id: 'a', skillRef: 'unapproved-skill' })];

      const result = validateWorkflow(nodes, [], approvedSkillKeys);
      expect(result.valid).toBe(true);
      expect(result.warnings).toContainEqual(
        expect.objectContaining({ type: 'UNRESOLVED_SKILL_REF', nodeId: 'a' }),
      );
    });

    it('no warning when skillRef is approved', () => {
      const approvedSkillKeys = new Set(['content-writer']);
      const nodes = [skillNode({ id: 'a', skillRef: 'content-writer' })];

      const result = validateWorkflow(nodes, [], approvedSkillKeys);
      expect(result.valid).toBe(true);
      expect(result.warnings.filter((w) => w.type === 'UNRESOLVED_SKILL_REF')).toHaveLength(0);
    });

    it('detects invalid stdin reference', () => {
      const nodes = [skillNode({ id: 'a', stdin: '$nonexistent.stdout' })];
      const result = validateWorkflow(nodes, []);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({ type: 'INVALID_STDIN_REF', nodeId: 'a' }),
      );
    });

    it('accepts valid stdin reference', () => {
      const nodes = [
        skillNode({ id: 'step1' }),
        skillNode({ id: 'step2', command: 'process', stdin: '$step1.stdout' }),
      ];
      const edges: WorkflowEdgeDef[] = [{ source: 'step1', target: 'step2' }];

      const result = validateWorkflow(nodes, edges);
      expect(result.valid).toBe(true);
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
        branches: [{ condition: '== true', target: 'nonexistent' }],
      })];
      const result = validateWorkflow(nodes, []);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({ type: 'INVALID_BRANCH_TARGET', nodeId: 'c' }),
      );
    });
  });

  describe('review node validation', () => {
    it('review nodes pass validation with no config', () => {
      const nodes = [reviewNode()];
      const result = validateWorkflow(nodes, []);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('review nodes pass with optional prompt', () => {
      const nodes = [reviewNode({ prompt: 'Please review' })];
      const result = validateWorkflow(nodes, []);
      expect(result.valid).toBe(true);
    });
  });

  describe('complex valid workflow', () => {
    it('validates a full pipeline workflow', () => {
      const nodes = [
        skillNode({ id: 'collect', command: 'inbox list --json' }),
        skillNode({ id: 'categorize', command: 'inbox categorize --json', stdin: '$collect.stdout' }),
        reviewNode({ id: 'approve', prompt: 'Review categorization' }),
        conditionNode({
          id: 'gate',
          expression: '$approve.approved',
          branches: [
            { condition: '== true', target: 'execute' },
            { condition: '== false', target: 'collect' },
          ],
        }),
        skillNode({ id: 'execute', command: 'inbox apply --execute', stdin: '$categorize.stdout' }),
      ];

      const edges: WorkflowEdgeDef[] = [
        { source: 'collect', target: 'categorize' },
        { source: 'categorize', target: 'approve' },
        { source: 'approve', target: 'gate' },
        { source: 'gate', target: 'execute' },
      ];

      const result = validateWorkflow(nodes, edges);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });
});
