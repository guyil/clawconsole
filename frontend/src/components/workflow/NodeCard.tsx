import { Puzzle, UserCheck, GitBranch, GripVertical, Trash2, AlertCircle } from 'lucide-react';
import type { WorkflowNodeDef, RunNodeStatus } from '../../types/workflow';

const nodeTypeConfig: Record<string, { label: string; icon: typeof Puzzle; color: string; bg: string }> = {
  skill: {
    label: 'Skill 节点',
    icon: Puzzle,
    color: 'text-claw-primary-light',
    bg: 'bg-claw-primary/15 border-claw-primary/30',
  },
  review: {
    label: '审核节点',
    icon: UserCheck,
    color: 'text-claw-warning',
    bg: 'bg-claw-warning/15 border-claw-warning/30',
  },
  condition: {
    label: '条件节点',
    icon: GitBranch,
    color: 'text-claw-accent',
    bg: 'bg-claw-accent/15 border-claw-accent/30',
  },
};

const runStatusConfig: Record<RunNodeStatus, { label: string; color: string }> = {
  pending: { label: '等待中', color: 'text-claw-muted' },
  running: { label: '执行中', color: 'text-claw-primary-light' },
  completed: { label: '已完成', color: 'text-claw-success' },
  failed: { label: '失败', color: 'text-claw-danger' },
  skipped: { label: '已跳过', color: 'text-claw-muted' },
  waiting_review: { label: '等待审核', color: 'text-claw-warning' },
};

interface NodeCardProps {
  node: WorkflowNodeDef;
  selected?: boolean;
  onClick?: () => void;
  onDelete?: () => void;
  readOnly?: boolean;
  runStatus?: RunNodeStatus;
  error?: string;
}

export function NodeCard({ node, selected, onClick, onDelete, readOnly, runStatus, error }: NodeCardProps) {
  const cfg = nodeTypeConfig[node.type];
  const Icon = cfg.icon;
  const statusCfg = runStatus ? runStatusConfig[runStatus] : null;

  return (
    <div
      className={`group relative flex items-center gap-3 px-4 py-3.5 rounded-xl border-2 transition-all duration-200 cursor-pointer
        ${selected ? `${cfg.bg} ring-2 ring-offset-1 ring-offset-claw-bg ring-claw-primary/40` : 'bg-claw-card border-claw-border hover:border-claw-primary/40'}
        ${error ? 'border-claw-danger/50' : ''}`}
      onClick={onClick}
    >
      {!readOnly && (
        <GripVertical size={14} className="text-claw-muted/40 shrink-0 group-hover:text-claw-muted" />
      )}

      <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${cfg.bg} border`}>
        <Icon size={18} className={cfg.color} />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-claw-text truncate">{node.name}</span>
          <span className="text-[10px] text-claw-muted px-1.5 py-0.5 bg-claw-input rounded">{cfg.label}</span>
        </div>
        <div className="text-xs text-claw-muted mt-0.5 truncate">
          {node.type === 'skill' && `skillRef: ${node.skillRef}`}
          {node.type === 'review' && `策略: ${node.policy === 'any' ? '任一通过' : '全部通过'} · ${node.reviewers.length} 位审核人`}
          {node.type === 'condition' && `表达式: ${node.expression}`}
        </div>
      </div>

      {statusCfg && (
        <span className={`text-xs font-medium shrink-0 ${statusCfg.color}`}>
          {runStatus === 'running' && (
            <span className="inline-block w-2 h-2 rounded-full bg-claw-primary-light animate-pulse mr-1" />
          )}
          {statusCfg.label}
        </span>
      )}

      {error && (
        <div className="absolute -right-2 -top-2">
          <AlertCircle size={16} className="text-claw-danger" />
        </div>
      )}

      {!readOnly && onDelete && (
        <button
          className="opacity-0 group-hover:opacity-100 text-claw-muted hover:text-claw-danger transition-all cursor-pointer p-1"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          title="删除节点"
        >
          <Trash2 size={14} />
        </button>
      )}
    </div>
  );
}
