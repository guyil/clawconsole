import type {
  WorkflowNodeDef,
  WorkflowEdgeDef,
  ValidationResult,
  ValidationError as VError,
  ValidationWarning,
} from './workflow.types.js';

/**
 * Validates a workflow DAG for structural correctness.
 * Checks: orphan nodes, missing targets, cycles, missing skill refs, etc.
 */
export function validateWorkflow(
  nodes: WorkflowNodeDef[],
  edges: WorkflowEdgeDef[],
  approvedSkillKeys?: Set<string>,
): ValidationResult {
  const errors: VError[] = [];
  const warnings: ValidationWarning[] = [];

  if (nodes.length === 0) {
    errors.push({ type: 'EMPTY_WORKFLOW', message: 'Workflow has no nodes' });
    return { valid: false, errors, warnings };
  }

  const nodeIds = new Set(nodes.map((n) => n.id));
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  // Check for duplicate node IDs
  const seenIds = new Set<string>();
  for (const node of nodes) {
    if (seenIds.has(node.id)) {
      errors.push({
        type: 'DUPLICATE_NODE_ID',
        nodeId: node.id,
        message: `Duplicate node ID: '${node.id}'`,
      });
    }
    seenIds.add(node.id);
  }

  // Check edges reference valid nodes
  for (const edge of edges) {
    if (!nodeIds.has(edge.source)) {
      errors.push({
        type: 'INVALID_EDGE_SOURCE',
        message: `Edge source '${edge.source}' does not exist`,
      });
    }
    if (!nodeIds.has(edge.target)) {
      errors.push({
        type: 'INVALID_EDGE_TARGET',
        message: `Edge target '${edge.target}' does not exist`,
      });
    }
  }

  // Build adjacency list
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  for (const id of nodeIds) {
    outgoing.set(id, []);
    incoming.set(id, []);
  }
  for (const edge of edges) {
    if (nodeIds.has(edge.source) && nodeIds.has(edge.target)) {
      outgoing.get(edge.source)!.push(edge.target);
      incoming.get(edge.target)!.push(edge.source);
    }
  }

  // Check for orphan nodes (no incoming and no outgoing edges, and not the only node)
  if (nodes.length > 1) {
    for (const node of nodes) {
      const hasIn = incoming.get(node.id)!.length > 0;
      const hasOut = outgoing.get(node.id)!.length > 0;
      if (!hasIn && !hasOut) {
        errors.push({
          type: 'ORPHAN_NODE',
          nodeId: node.id,
          message: `Node '${node.id}' is not connected to any edge`,
        });
      }
    }
  }

  // Check for start nodes (no incoming edges)
  const startNodes = nodes.filter((n) => incoming.get(n.id)!.length === 0);
  if (startNodes.length === 0 && nodes.length > 1) {
    errors.push({
      type: 'NO_START_NODE',
      message: 'Workflow has no start node (all nodes have incoming edges, indicating a cycle)',
    });
  }

  // Cycle detection using DFS
  const cycles = detectCycles(nodeIds, outgoing);
  for (const cycle of cycles) {
    errors.push({
      type: 'CYCLE_DETECTED',
      path: cycle,
      message: `Circular dependency detected: ${cycle.join(' → ')}`,
    });
  }

  // Validate skill nodes
  for (const node of nodes) {
    if (node.type === 'skill') {
      if (!node.skillRef || node.skillRef.trim().length === 0) {
        errors.push({
          type: 'MISSING_SKILL_REF',
          nodeId: node.id,
          message: `Skill node '${node.id}' has no skillRef`,
        });
      } else if (approvedSkillKeys && !approvedSkillKeys.has(node.skillRef)) {
        errors.push({
          type: 'MISSING_SKILL',
          nodeId: node.id,
          message: `Referenced skill '${node.skillRef}' not found or not approved`,
        });
      }

      if (!node.output || node.output.trim().length === 0) {
        errors.push({
          type: 'MISSING_OUTPUT',
          nodeId: node.id,
          message: `Skill node '${node.id}' has no output key`,
        });
      }
    }

    if (node.type === 'review') {
      if (!node.reviewers || node.reviewers.length === 0) {
        errors.push({
          type: 'NO_REVIEWERS',
          nodeId: node.id,
          message: `Review node '${node.id}' has no reviewers defined`,
        });
      }

      if (!node.timeout) {
        warnings.push({
          type: 'NO_TIMEOUT',
          nodeId: node.id,
          message: `Review node '${node.id}' has no timeout configured`,
        });
      }
    }

    if (node.type === 'condition') {
      if (!node.expression || node.expression.trim().length === 0) {
        errors.push({
          type: 'MISSING_EXPRESSION',
          nodeId: node.id,
          message: `Condition node '${node.id}' has no expression`,
        });
      }

      if (!node.branches || node.branches.length === 0) {
        errors.push({
          type: 'NO_BRANCHES',
          nodeId: node.id,
          message: `Condition node '${node.id}' has no branches defined`,
        });
      } else {
        for (const branch of node.branches) {
          if (!nodeIds.has(branch.target)) {
            errors.push({
              type: 'INVALID_BRANCH_TARGET',
              nodeId: node.id,
              message: `Branch target '${branch.target}' in condition node '${node.id}' does not exist`,
            });
          }
        }
      }
    }
  }

  // Check for duplicate output keys across skill nodes
  const outputKeys = new Set<string>();
  for (const node of nodes) {
    if (node.type === 'skill' && node.output) {
      if (outputKeys.has(node.output)) {
        errors.push({
          type: 'DUPLICATE_OUTPUT_KEY',
          nodeId: node.id,
          message: `Duplicate output key '${node.output}' in node '${node.id}'`,
        });
      }
      outputKeys.add(node.output);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Detect cycles in a directed graph using DFS.
 * Returns array of cycle paths.
 */
function detectCycles(
  nodeIds: Set<string>,
  outgoing: Map<string, string[]>,
): string[][] {
  const WHITE = 0; // unvisited
  const GRAY = 1;  // in current DFS path
  const BLACK = 2; // fully processed

  const color = new Map<string, number>();
  for (const id of nodeIds) color.set(id, WHITE);

  const parent = new Map<string, string | null>();
  const cycles: string[][] = [];

  function dfs(u: string): void {
    color.set(u, GRAY);

    for (const v of outgoing.get(u) ?? []) {
      if (color.get(v) === GRAY) {
        // Found a back edge → extract cycle
        const cycle: string[] = [v, u];
        let curr = u;
        while (parent.get(curr) !== null && parent.get(curr) !== v) {
          curr = parent.get(curr)!;
          cycle.push(curr);
        }
        cycle.reverse();
        cycles.push(cycle);
      } else if (color.get(v) === WHITE) {
        parent.set(v, u);
        dfs(v);
      }
    }

    color.set(u, BLACK);
  }

  for (const id of nodeIds) {
    if (color.get(id) === WHITE) {
      parent.set(id, null);
      dfs(id);
    }
  }

  return cycles;
}
