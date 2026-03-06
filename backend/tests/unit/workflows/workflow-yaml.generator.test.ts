import { describe, it, expect } from 'vitest';
import yaml from 'js-yaml';
import { generateWorkflowYaml } from '../../../src/generators/workflow-yaml.generator.js';
import type { Workflow } from '../../../src/modules/workflows/workflow.types.js';

function makeWorkflow(overrides: Partial<Workflow> = {}): Workflow {
  return {
    id: 'wf-1',
    name: 'content-pipeline',
    description: 'AI content generation pipeline',
    machineId: 'machine-1',
    agentId: null,
    status: 'active',
    version: '1.2.0',
    triggerConfig: {
      type: 'message',
      channel: 'feishu',
      pattern: '/publish *',
    },
    nodes: [
      {
        id: 'draft',
        type: 'skill',
        name: 'Generate Draft',
        skillRef: 'content-writer',
        input: { topic: '{{ trigger.message }}' },
        output: 'draft_result',
        timeout: '5m',
      },
      {
        id: 'review',
        type: 'review',
        name: 'Manager Review',
        reviewers: [{ role: 'content_manager' }],
        policy: 'any',
        timeout: '2h',
        escalation: {
          action: 'notify',
          target: [{ role: 'admin' }],
          message: 'Review timed out',
        },
        payload: { title: 'Review content' },
      },
      {
        id: 'gate',
        type: 'condition',
        name: 'Quality Gate',
        expression: '{{ nodes.draft.output.score > 0.8 }}',
        branches: [
          { condition: 'true', target: 'publish' },
          { condition: 'false', target: 'revise' },
        ],
        default: 'revise',
      },
    ],
    edges: [
      { source: 'draft', target: 'review' },
      { source: 'review', target: 'gate' },
    ],
    variables: { topic: '{{ trigger.message }}', threshold: 0.8 },
    canvasState: null,
    createdBy: 'admin',
    updatedBy: null,
    deployedAt: new Date('2026-03-01'),
    createdAt: new Date('2026-03-01'),
    updatedAt: new Date('2026-03-01'),
    ...overrides,
  };
}

describe('generateWorkflowYaml', () => {
  it('generates valid YAML with correct apiVersion', () => {
    const result = generateWorkflowYaml(makeWorkflow());
    const parsed = yaml.load(result) as Record<string, unknown>;

    expect(parsed.apiVersion).toBe('lobster/v1');
    expect(parsed.kind).toBe('Workflow');
  });

  it('includes metadata', () => {
    const result = generateWorkflowYaml(makeWorkflow());
    const parsed = yaml.load(result) as any;

    expect(parsed.metadata.name).toBe('content-pipeline');
    expect(parsed.metadata.version).toBe('1.2.0');
    expect(parsed.metadata.description).toBe('AI content generation pipeline');
  });

  it('includes trigger config for non-manual triggers', () => {
    const result = generateWorkflowYaml(makeWorkflow());
    const parsed = yaml.load(result) as any;

    expect(parsed.trigger).toBeDefined();
    expect(parsed.trigger.type).toBe('message');
    expect(parsed.trigger.channel).toBe('feishu');
    expect(parsed.trigger.pattern).toBe('/publish *');
  });

  it('omits trigger for manual type', () => {
    const result = generateWorkflowYaml(makeWorkflow({
      triggerConfig: { type: 'manual' },
    }));
    const parsed = yaml.load(result) as any;

    expect(parsed.trigger).toBeUndefined();
  });

  it('includes variables', () => {
    const result = generateWorkflowYaml(makeWorkflow());
    const parsed = yaml.load(result) as any;

    expect(parsed.variables).toBeDefined();
    expect(parsed.variables.topic).toBe('{{ trigger.message }}');
    expect(parsed.variables.threshold).toBe(0.8);
  });

  it('omits variables when empty', () => {
    const result = generateWorkflowYaml(makeWorkflow({ variables: null }));
    const parsed = yaml.load(result) as any;

    expect(parsed.variables).toBeUndefined();
  });

  it('generates skill nodes correctly', () => {
    const result = generateWorkflowYaml(makeWorkflow());
    const parsed = yaml.load(result) as any;

    const draftNode = parsed.nodes.find((n: any) => n.id === 'draft');
    expect(draftNode).toBeDefined();
    expect(draftNode.type).toBe('skill');
    expect(draftNode.skillRef).toBe('content-writer');
    expect(draftNode.input.topic).toBe('{{ trigger.message }}');
    expect(draftNode.output).toBe('draft_result');
    expect(draftNode.timeout).toBe('5m');
  });

  it('generates review nodes correctly', () => {
    const result = generateWorkflowYaml(makeWorkflow());
    const parsed = yaml.load(result) as any;

    const reviewNode = parsed.nodes.find((n: any) => n.id === 'review');
    expect(reviewNode).toBeDefined();
    expect(reviewNode.type).toBe('review');
    expect(reviewNode.reviewers).toEqual([{ role: 'content_manager' }]);
    expect(reviewNode.policy).toBe('any');
    expect(reviewNode.timeout).toBe('2h');
    expect(reviewNode.escalation.action).toBe('notify');
    expect(reviewNode.escalation.target).toEqual([{ role: 'admin' }]);
    expect(reviewNode.payload.title).toBe('Review content');
  });

  it('generates condition nodes correctly', () => {
    const result = generateWorkflowYaml(makeWorkflow());
    const parsed = yaml.load(result) as any;

    const gateNode = parsed.nodes.find((n: any) => n.id === 'gate');
    expect(gateNode).toBeDefined();
    expect(gateNode.type).toBe('condition');
    expect(gateNode.expression).toBe('{{ nodes.draft.output.score > 0.8 }}');
    expect(gateNode.branches).toHaveLength(2);
    expect(gateNode.default).toBe('revise');
  });

  it('generates edges correctly', () => {
    const result = generateWorkflowYaml(makeWorkflow());
    const parsed = yaml.load(result) as any;

    expect(parsed.edges).toHaveLength(2);
    expect(parsed.edges[0]).toEqual({ source: 'draft', target: 'review' });
    expect(parsed.edges[1]).toEqual({ source: 'review', target: 'gate' });
  });

  it('includes edge conditions', () => {
    const result = generateWorkflowYaml(makeWorkflow({
      edges: [
        { source: 'review', target: 'publish', condition: '{{ approved }}' },
      ],
    }));
    const parsed = yaml.load(result) as any;

    expect(parsed.edges[0].condition).toBe('{{ approved }}');
  });

  it('generates parseable YAML', () => {
    const result = generateWorkflowYaml(makeWorkflow());

    // Should not throw
    expect(() => yaml.load(result)).not.toThrow();

    // Should be a non-empty string
    expect(result.length).toBeGreaterThan(50);
    expect(result).toContain('apiVersion: lobster/v1');
  });

  it('omits optional fields when not present', () => {
    const result = generateWorkflowYaml(makeWorkflow({
      nodes: [{
        id: 'simple',
        type: 'skill',
        name: 'Simple Task',
        skillRef: 'basic-skill',
        output: 'result',
      }],
      edges: [],
      variables: null,
      description: null,
    }));
    const parsed = yaml.load(result) as any;

    const node = parsed.nodes[0];
    expect(node.input).toBeUndefined();
    expect(node.timeout).toBeUndefined();
    expect(node.retryPolicy).toBeUndefined();
    expect(node.onError).toBeUndefined();
    expect(parsed.variables).toBeUndefined();
    expect(parsed.metadata.description).toBeUndefined();
  });

  it('does not include abort as default onError', () => {
    const result = generateWorkflowYaml(makeWorkflow({
      nodes: [{
        id: 'task',
        type: 'skill',
        name: 'Task',
        skillRef: 'skill-1',
        output: 'out',
        onError: 'abort',
      }],
    }));
    const parsed = yaml.load(result) as any;
    // abort is the default, should be omitted
    expect(parsed.nodes[0].onError).toBeUndefined();
  });

  it('includes skip onError', () => {
    const result = generateWorkflowYaml(makeWorkflow({
      nodes: [{
        id: 'task',
        type: 'skill',
        name: 'Task',
        skillRef: 'skill-1',
        output: 'out',
        onError: 'skip',
      }],
    }));
    const parsed = yaml.load(result) as any;
    expect(parsed.nodes[0].onError).toBe('skip');
  });
});
