import yaml from 'js-yaml';
import type { Workflow, WorkflowNodeDef, WorkflowEdgeDef } from '../modules/workflows/workflow.types.js';

interface LobsterWorkflowYaml {
  apiVersion: string;
  kind: string;
  metadata: {
    name: string;
    description?: string;
    version: string;
  };
  trigger?: {
    type: string;
    channel?: string;
    pattern?: string;
    cron?: string;
  };
  variables?: Record<string, unknown>;
  nodes: LobsterNode[];
  edges: LobsterEdge[];
}

interface LobsterNode {
  id: string;
  type: string;
  name: string;
  skillRef?: string;
  input?: Record<string, string>;
  output?: string;
  timeout?: string;
  retryPolicy?: { maxRetries: number; backoff?: string };
  onError?: string;
  reviewers?: Array<Record<string, string>>;
  policy?: string;
  escalation?: {
    action: string;
    target: Array<Record<string, string>>;
    message?: string;
  };
  payload?: Record<string, string>;
  expression?: string;
  branches?: Array<{ condition: string; target: string }>;
  default?: string;
}

interface LobsterEdge {
  source: string;
  target: string;
  condition?: string;
}

function nodeDefToLobster(node: WorkflowNodeDef): LobsterNode {
  const base: LobsterNode = {
    id: node.id,
    type: node.type,
    name: node.name,
  };

  if (node.type === 'skill') {
    base.skillRef = node.skillRef;
    if (node.input && Object.keys(node.input).length > 0) base.input = node.input;
    base.output = node.output;
    if (node.timeout) base.timeout = node.timeout;
    if (node.retryPolicy) base.retryPolicy = node.retryPolicy;
    if (node.onError && node.onError !== 'abort') base.onError = node.onError;
  }

  if (node.type === 'review') {
    base.reviewers = node.reviewers.map((r) => {
      const ref: Record<string, string> = {};
      if (r.userId) ref.userId = r.userId;
      if (r.role) ref.role = r.role;
      if (r.group) ref.group = r.group;
      return ref;
    });
    base.policy = node.policy;
    if (node.timeout) base.timeout = node.timeout;
    if (node.escalation) {
      base.escalation = {
        action: node.escalation.action,
        target: node.escalation.target.map((t) => {
          const ref: Record<string, string> = {};
          if (t.userId) ref.userId = t.userId;
          if (t.role) ref.role = t.role;
          if (t.group) ref.group = t.group;
          return ref;
        }),
      };
      if (node.escalation.message) base.escalation.message = node.escalation.message;
    }
    if (node.payload && Object.keys(node.payload).length > 0) base.payload = node.payload;
  }

  if (node.type === 'condition') {
    base.expression = node.expression;
    base.branches = node.branches;
    if (node.default) base.default = node.default;
  }

  return base;
}

function edgeDefToLobster(edge: WorkflowEdgeDef): LobsterEdge {
  const result: LobsterEdge = { source: edge.source, target: edge.target };
  if (edge.condition) result.condition = edge.condition;
  return result;
}

/**
 * Generate a Lobster-compatible YAML string from a Workflow entity.
 */
export function generateWorkflowYaml(workflow: Workflow): string {
  const doc: LobsterWorkflowYaml = {
    apiVersion: 'lobster/v1',
    kind: 'Workflow',
    metadata: {
      name: workflow.name,
      version: workflow.version,
    },
  };

  if (workflow.description) {
    doc.metadata.description = workflow.description;
  }

  if (workflow.triggerConfig && workflow.triggerConfig.type !== 'manual') {
    doc.trigger = { type: workflow.triggerConfig.type };
    if (workflow.triggerConfig.channel) doc.trigger.channel = workflow.triggerConfig.channel;
    if (workflow.triggerConfig.pattern) doc.trigger.pattern = workflow.triggerConfig.pattern;
    if (workflow.triggerConfig.cron) doc.trigger.cron = workflow.triggerConfig.cron;
  }

  if (workflow.variables && Object.keys(workflow.variables).length > 0) {
    doc.variables = workflow.variables;
  }

  doc.nodes = workflow.nodes.map(nodeDefToLobster);
  doc.edges = workflow.edges.map(edgeDefToLobster);

  return yaml.dump(doc, {
    indent: 2,
    lineWidth: 120,
    noRefs: true,
    sortKeys: false,
    quotingType: '"',
    forceQuotes: false,
  });
}
