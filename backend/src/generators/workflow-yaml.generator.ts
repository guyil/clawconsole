import yaml from 'js-yaml';
import type { Workflow, WorkflowNodeDef, WorkflowEdgeDef } from '../modules/workflows/workflow.types.js';

interface LobsterStep {
  id: string;
  command: string;
  stdin?: string;
  approval?: string;
  condition?: string;
}

interface LobsterPipeline {
  name: string;
  args?: Record<string, { default?: unknown }>;
  steps: LobsterStep[];
}

/**
 * Topologically sort nodes using edges (Kahn's algorithm).
 * Falls back to original order for nodes not connected by edges.
 */
function topologicalSort(nodes: WorkflowNodeDef[], edges: WorkflowEdgeDef[]): WorkflowNodeDef[] {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const node of nodes) {
    inDegree.set(node.id, 0);
    adjacency.set(node.id, []);
  }

  for (const edge of edges) {
    if (nodeMap.has(edge.source) && nodeMap.has(edge.target)) {
      adjacency.get(edge.source)!.push(edge.target);
      inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
    }
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const sorted: WorkflowNodeDef[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const node = nodeMap.get(id);
    if (node) sorted.push(node);

    for (const neighbor of adjacency.get(id) ?? []) {
      const newDeg = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) queue.push(neighbor);
    }
  }

  // Include any disconnected nodes that weren't reached
  for (const node of nodes) {
    if (!sorted.find((s) => s.id === node.id)) {
      sorted.push(node);
    }
  }

  return sorted;
}

/**
 * Build a map from target nodeId -> source nodeId for stdin references.
 */
function buildStdinMap(edges: WorkflowEdgeDef[]): Map<string, string> {
  const stdinMap = new Map<string, string>();
  for (const edge of edges) {
    // Each node takes stdin from its first incoming edge source
    if (!stdinMap.has(edge.target)) {
      stdinMap.set(edge.target, edge.source);
    }
  }
  return stdinMap;
}

function nodeToStep(
  node: WorkflowNodeDef,
  stdinMap: Map<string, string>,
  edgeConditions: Map<string, string>,
): LobsterStep {
  const step: LobsterStep = {
    id: node.id,
    command: '',
  };

  if (node.type === 'skill') {
    step.command = node.command;

    const stdinSource = node.stdin || (stdinMap.has(node.id) ? `$${stdinMap.get(node.id)}.stdout` : undefined);
    if (stdinSource) step.stdin = stdinSource;
  }

  if (node.type === 'review') {
    // Approval gate — command shows a prompt, Lobster pauses for approval
    step.command = node.prompt
      ? `echo ${JSON.stringify(node.prompt)}`
      : `echo "Review required: ${node.name}"`;
    step.approval = 'required';

    const stdinSource = stdinMap.get(node.id);
    if (stdinSource) step.stdin = `$${stdinSource}.stdout`;
  }

  if (node.type === 'condition') {
    step.command = `echo "Condition: ${node.expression}"`;
    step.condition = node.expression;
  }

  // Apply edge-based conditions (from condition nodes' branches)
  const edgeCondition = edgeConditions.get(node.id);
  if (edgeCondition && !step.condition) {
    step.condition = edgeCondition;
  }

  return step;
}

/**
 * Build a map of nodeId -> condition expression from condition nodes' branches and edges.
 */
function buildEdgeConditions(
  nodes: WorkflowNodeDef[],
  edges: WorkflowEdgeDef[],
): Map<string, string> {
  const conditions = new Map<string, string>();

  for (const node of nodes) {
    if (node.type === 'condition') {
      for (const branch of node.branches) {
        conditions.set(branch.target, branch.condition);
      }
    }
  }

  // Also pick up conditions from edges directly
  for (const edge of edges) {
    if (edge.condition && !conditions.has(edge.target)) {
      conditions.set(edge.target, edge.condition);
    }
  }

  return conditions;
}

/**
 * Generate a Lobster-compatible .lobster YAML string from a Workflow entity.
 */
export function generateWorkflowYaml(workflow: Workflow): string {
  const sortedNodes = topologicalSort(workflow.nodes, workflow.edges);
  const stdinMap = buildStdinMap(workflow.edges);
  const edgeConditions = buildEdgeConditions(workflow.nodes, workflow.edges);

  const steps: LobsterStep[] = sortedNodes.map((node) =>
    nodeToStep(node, stdinMap, edgeConditions),
  );

  const pipeline: LobsterPipeline = {
    name: workflow.workflowKey || workflow.name,
    steps,
  };

  // Map workflow variables to Lobster args format
  if (workflow.variables && Object.keys(workflow.variables).length > 0) {
    pipeline.args = {};
    for (const [key, value] of Object.entries(workflow.variables)) {
      pipeline.args[key] = { default: value };
    }
  }

  return yaml.dump(pipeline, {
    indent: 2,
    lineWidth: 120,
    noRefs: true,
    sortKeys: false,
    quotingType: '"',
    forceQuotes: false,
  });
}
