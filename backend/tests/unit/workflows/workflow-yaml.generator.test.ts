import { describe, it, expect } from 'vitest';
import yaml from 'js-yaml';
import { generateWorkflowYaml } from '../../../src/generators/workflow-yaml.generator.js';
import type { Workflow } from '../../../src/modules/workflows/workflow.types.js';

function makeWorkflow(overrides: Partial<Workflow> = {}): Workflow {
  return {
    id: 'wf-1',
    name: 'content-pipeline',
    description: 'AI content generation pipeline',
    workflowKey: 'content-pipeline',
    machineId: 'machine-1',
    agentId: null,
    status: 'active',
    version: '1.2.0',
    triggerConfig: { type: 'manual' },
    nodes: [
      {
        id: 'collect',
        type: 'skill',
        name: 'Collect Data',
        command: 'inbox list --json',
      },
      {
        id: 'categorize',
        type: 'skill',
        name: 'Categorize',
        command: 'inbox categorize --json',
        stdin: '$collect.stdout',
      },
      {
        id: 'approve',
        type: 'review',
        name: 'Manager Approval',
        prompt: 'Please review the categorization results',
      },
      {
        id: 'execute',
        type: 'skill',
        name: 'Execute',
        command: 'inbox apply --execute',
        stdin: '$categorize.stdout',
      },
    ],
    edges: [
      { source: 'collect', target: 'categorize' },
      { source: 'categorize', target: 'approve' },
      { source: 'approve', target: 'execute' },
    ],
    variables: { tag: 'family' },
    canvasState: null,
    createdBy: 'admin',
    updatedBy: null,
    deployedAt: new Date('2026-03-01'),
    createdAt: new Date('2026-03-01'),
    updatedAt: new Date('2026-03-01'),
    ...overrides,
  };
}

describe('generateWorkflowYaml (Lobster .lobster format)', () => {
  it('generates valid YAML with name and steps', () => {
    const result = generateWorkflowYaml(makeWorkflow());
    const parsed = yaml.load(result) as Record<string, unknown>;

    expect(parsed.name).toBe('content-pipeline');
    expect(parsed.steps).toBeDefined();
    expect(Array.isArray(parsed.steps)).toBe(true);
  });

  it('does not include old apiVersion/kind/metadata format', () => {
    const result = generateWorkflowYaml(makeWorkflow());
    const parsed = yaml.load(result) as Record<string, unknown>;

    expect(parsed).not.toHaveProperty('apiVersion');
    expect(parsed).not.toHaveProperty('kind');
    expect(parsed).not.toHaveProperty('metadata');
    expect(parsed).not.toHaveProperty('nodes');
    expect(parsed).not.toHaveProperty('edges');
  });

  it('maps workflow variables to Lobster args format', () => {
    const result = generateWorkflowYaml(makeWorkflow());
    const parsed = yaml.load(result) as Record<string, unknown>;

    expect(parsed.args).toBeDefined();
    const args = parsed.args as Record<string, { default: unknown }>;
    expect(args.tag).toEqual({ default: 'family' });
  });

  it('omits args when no variables', () => {
    const result = generateWorkflowYaml(makeWorkflow({ variables: null }));
    const parsed = yaml.load(result) as Record<string, unknown>;

    expect(parsed.args).toBeUndefined();
  });

  it('generates skill steps with command', () => {
    const result = generateWorkflowYaml(makeWorkflow());
    const parsed = yaml.load(result) as { steps: Array<Record<string, unknown>> };

    const collectStep = parsed.steps.find((s) => s.id === 'collect');
    expect(collectStep).toBeDefined();
    expect(collectStep!.command).toBe('inbox list --json');
    expect(collectStep!.stdin).toBeUndefined();
  });

  it('generates skill steps with stdin reference', () => {
    const result = generateWorkflowYaml(makeWorkflow());
    const parsed = yaml.load(result) as { steps: Array<Record<string, unknown>> };

    const categorizeStep = parsed.steps.find((s) => s.id === 'categorize');
    expect(categorizeStep).toBeDefined();
    expect(categorizeStep!.command).toBe('inbox categorize --json');
    expect(categorizeStep!.stdin).toBe('$collect.stdout');
  });

  it('generates review steps with approval: required', () => {
    const result = generateWorkflowYaml(makeWorkflow());
    const parsed = yaml.load(result) as { steps: Array<Record<string, unknown>> };

    const approveStep = parsed.steps.find((s) => s.id === 'approve');
    expect(approveStep).toBeDefined();
    expect(approveStep!.approval).toBe('required');
    expect(approveStep!.command).toContain('review');
  });

  it('generates steps in topological order', () => {
    const result = generateWorkflowYaml(makeWorkflow());
    const parsed = yaml.load(result) as { steps: Array<Record<string, unknown>> };

    const ids = parsed.steps.map((s) => s.id);
    expect(ids.indexOf('collect')).toBeLessThan(ids.indexOf('categorize'));
    expect(ids.indexOf('categorize')).toBeLessThan(ids.indexOf('approve'));
    expect(ids.indexOf('approve')).toBeLessThan(ids.indexOf('execute'));
  });

  it('auto-generates stdin from edges when node has no explicit stdin', () => {
    const result = generateWorkflowYaml(makeWorkflow({
      nodes: [
        { id: 'step1', type: 'skill', name: 'Step 1', command: 'echo hello' },
        { id: 'step2', type: 'skill', name: 'Step 2', command: 'process' },
      ],
      edges: [{ source: 'step1', target: 'step2' }],
    }));
    const parsed = yaml.load(result) as { steps: Array<Record<string, unknown>> };

    const step2 = parsed.steps.find((s) => s.id === 'step2');
    expect(step2!.stdin).toBe('$step1.stdout');
  });

  it('generates condition steps with condition field', () => {
    const result = generateWorkflowYaml(makeWorkflow({
      nodes: [
        { id: 'check', type: 'skill', name: 'Check', command: 'test --check' },
        {
          id: 'gate',
          type: 'condition',
          name: 'Quality Gate',
          expression: '$check.passed',
          branches: [
            { condition: '== true', target: 'proceed' },
            { condition: '== false', target: 'retry' },
          ],
        },
      ],
      edges: [{ source: 'check', target: 'gate' }],
    }));
    const parsed = yaml.load(result) as { steps: Array<Record<string, unknown>> };

    const gateStep = parsed.steps.find((s) => s.id === 'gate');
    expect(gateStep).toBeDefined();
    expect(gateStep!.condition).toBe('$check.passed');
  });

  it('applies condition from condition node branches to target steps', () => {
    const result = generateWorkflowYaml(makeWorkflow({
      nodes: [
        {
          id: 'gate',
          type: 'condition',
          name: 'Gate',
          expression: '$prev.status',
          branches: [{ condition: '$prev.approved', target: 'proceed' }],
        },
        { id: 'proceed', type: 'skill', name: 'Proceed', command: 'do-thing' },
      ],
      edges: [{ source: 'gate', target: 'proceed' }],
    }));
    const parsed = yaml.load(result) as { steps: Array<Record<string, unknown>> };

    const proceedStep = parsed.steps.find((s) => s.id === 'proceed');
    expect(proceedStep!.condition).toBe('$prev.approved');
  });

  it('generates parseable YAML', () => {
    const result = generateWorkflowYaml(makeWorkflow());
    expect(() => yaml.load(result)).not.toThrow();
    expect(result.length).toBeGreaterThan(30);
    expect(result).toContain('name: content-pipeline');
    expect(result).toContain('steps:');
  });
});
