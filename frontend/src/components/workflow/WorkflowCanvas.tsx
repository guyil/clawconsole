import { useState } from 'react';
import { Plus, Puzzle, UserCheck, GitBranch, ArrowDown } from 'lucide-react';
import { NodeCard } from './NodeCard';
import type { WorkflowNodeDef, WorkflowEdgeDef } from '../../types/workflow';

interface WorkflowCanvasProps {
  nodes: WorkflowNodeDef[];
  edges: WorkflowEdgeDef[];
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
  onDeleteNode?: (id: string) => void;
  onAddNode?: (type: 'skill' | 'review' | 'condition', afterNodeId?: string) => void;
  readOnly?: boolean;
  validationErrors?: Record<string, string>;
}

const nodeTypes = [
  { type: 'skill' as const, label: 'Skill', icon: Puzzle, desc: '执行一个 Skill 任务' },
  { type: 'review' as const, label: '审核', icon: UserCheck, desc: '人工审核节点' },
  { type: 'condition' as const, label: '条件', icon: GitBranch, desc: '条件分支判断' },
];

export function WorkflowCanvas({
  nodes,
  edges,
  selectedNodeId,
  onSelectNode,
  onDeleteNode,
  onAddNode,
  readOnly,
  validationErrors,
}: WorkflowCanvasProps) {
  const [addMenuAt, setAddMenuAt] = useState<string | null>(null);

  // Build a linear ordering from edges (topological sort)
  const orderedNodes = topologicalSort(nodes, edges);

  return (
    <div className="flex flex-col items-center py-8 px-4 min-h-full">
      {/* Trigger indicator */}
      <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-claw-primary/15 border border-claw-primary/30 text-claw-primary-light text-xs font-medium mb-3">
        <div className="w-2 h-2 rounded-full bg-claw-primary-light" />
        触发器启动
      </div>

      {orderedNodes.length === 0 && !readOnly && (
        <div className="flex flex-col items-center gap-3 py-12">
          <p className="text-claw-muted text-sm">开始构建你的工作流</p>
          <div className="flex gap-2">
            {nodeTypes.map((nt) => (
              <button
                key={nt.type}
                onClick={() => onAddNode?.(nt.type)}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-claw-card border border-claw-border hover:border-claw-primary/40 text-sm text-claw-text transition-all cursor-pointer"
              >
                <nt.icon size={16} className="text-claw-primary-light" />
                {nt.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {orderedNodes.map((node, i) => (
        <div key={node.id} className="flex flex-col items-center w-full max-w-md">
          {/* Connector line */}
          {i > 0 && (
            <div className="flex flex-col items-center my-1">
              <div className="w-px h-5 bg-claw-border" />
              <ArrowDown size={14} className="text-claw-muted -my-1" />
              <div className="w-px h-2 bg-claw-border" />
            </div>
          )}

          {/* Node card */}
          <div className="w-full">
            <NodeCard
              node={node}
              selected={selectedNodeId === node.id}
              onClick={() => onSelectNode(selectedNodeId === node.id ? null : node.id)}
              onDelete={!readOnly && onDeleteNode ? () => onDeleteNode(node.id) : undefined}
              readOnly={readOnly}
              error={validationErrors?.[node.id]}
            />
          </div>

          {/* Condition branches indicator */}
          {node.type === 'condition' && node.branches.length > 0 && (
            <div className="flex items-center gap-4 mt-2 px-6">
              {node.branches.map((b, bi) => (
                <div key={bi} className="flex items-center gap-1 text-[10px] text-claw-muted bg-claw-input px-2 py-0.5 rounded">
                  <span className="text-claw-accent font-mono">{b.condition}</span>
                  <span>→ {b.target}</span>
                </div>
              ))}
            </div>
          )}

          {/* Add node button between nodes */}
          {!readOnly && (
            <div className="relative flex flex-col items-center my-1">
              <div className="w-px h-3 bg-claw-border" />
              <button
                onClick={() => setAddMenuAt(addMenuAt === node.id ? null : node.id)}
                className="w-7 h-7 rounded-full bg-claw-card border border-claw-border hover:border-claw-primary hover:bg-claw-primary/10 flex items-center justify-center transition-all cursor-pointer"
                title="添加节点"
              >
                <Plus size={14} className="text-claw-muted" />
              </button>

              {/* Add menu dropdown */}
              {addMenuAt === node.id && (
                <div className="absolute top-10 z-20 bg-claw-sidebar border border-claw-border rounded-xl shadow-2xl py-1.5 min-w-[180px]">
                  {nodeTypes.map((nt) => (
                    <button
                      key={nt.type}
                      onClick={() => {
                        onAddNode?.(nt.type, node.id);
                        setAddMenuAt(null);
                      }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-claw-text hover:bg-claw-card transition-colors cursor-pointer"
                    >
                      <nt.icon size={16} className="text-claw-primary-light" />
                      <div className="text-left">
                        <div className="font-medium">{nt.label}</div>
                        <div className="text-[10px] text-claw-muted">{nt.desc}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      ))}

      {/* End indicator */}
      {orderedNodes.length > 0 && (
        <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-claw-success/15 border border-claw-success/30 text-claw-success text-xs font-medium mt-3">
          <div className="w-2 h-2 rounded-full bg-claw-success" />
          工作流结束
        </div>
      )}
    </div>
  );
}

/** Simple topological sort based on edges; falls back to original order */
function topologicalSort(nodes: WorkflowNodeDef[], edges: WorkflowEdgeDef[]): WorkflowNodeDef[] {
  if (nodes.length === 0) return [];
  if (edges.length === 0) return nodes;

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();

  for (const n of nodes) {
    inDegree.set(n.id, 0);
    adj.set(n.id, []);
  }

  for (const e of edges) {
    if (nodeMap.has(e.source) && nodeMap.has(e.target)) {
      adj.get(e.source)!.push(e.target);
      inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);
    }
  }

  const queue = nodes.filter((n) => (inDegree.get(n.id) ?? 0) === 0).map((n) => n.id);
  const result: WorkflowNodeDef[] = [];

  while (queue.length > 0) {
    const id = queue.shift()!;
    const node = nodeMap.get(id);
    if (node) result.push(node);
    for (const next of adj.get(id) ?? []) {
      const d = (inDegree.get(next) ?? 1) - 1;
      inDegree.set(next, d);
      if (d === 0) queue.push(next);
    }
  }

  // Include any nodes not reached (orphans / cycle members)
  for (const n of nodes) {
    if (!result.find((r) => r.id === n.id)) result.push(n);
  }

  return result;
}
