import { CheckCircle, XCircle, Clock, Loader2, SkipForward, UserCheck } from 'lucide-react';
import type { WorkflowRunNode, RunNodeStatus } from '../../types/workflow';

const statusIcon: Record<RunNodeStatus, { icon: typeof CheckCircle; color: string }> = {
  completed: { icon: CheckCircle, color: 'text-claw-success' },
  failed: { icon: XCircle, color: 'text-claw-danger' },
  running: { icon: Loader2, color: 'text-claw-primary-light' },
  pending: { icon: Clock, color: 'text-claw-muted' },
  skipped: { icon: SkipForward, color: 'text-claw-muted' },
  waiting_review: { icon: UserCheck, color: 'text-claw-warning' },
};

const statusLabel: Record<RunNodeStatus, string> = {
  completed: '已完成',
  failed: '失败',
  running: '执行中',
  pending: '等待中',
  skipped: '已跳过',
  waiting_review: '等待审核',
};

interface RunTimelineProps {
  nodes: WorkflowRunNode[];
  onSelectNode?: (node: WorkflowRunNode) => void;
  selectedNodeId?: string;
}

export function RunTimeline({ nodes, onSelectNode, selectedNodeId }: RunTimelineProps) {
  return (
    <div className="relative">
      {nodes.map((node, i) => {
        const cfg = statusIcon[node.status];
        const Icon = cfg.icon;
        const isLast = i === nodes.length - 1;
        const isSelected = selectedNodeId === node.nodeId;

        return (
          <div key={node.id} className="flex gap-4">
            {/* Timeline line & dot */}
            <div className="flex flex-col items-center">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center border-2 shrink-0 ${
                isSelected ? 'border-claw-primary bg-claw-primary/15' : 'border-claw-border bg-claw-card'
              }`}>
                <Icon
                  size={16}
                  className={`${cfg.color} ${node.status === 'running' ? 'animate-spin' : ''}`}
                />
              </div>
              {!isLast && <div className="w-px flex-1 min-h-[24px] bg-claw-border" />}
            </div>

            {/* Content */}
            <div
              className={`flex-1 pb-5 cursor-pointer group`}
              onClick={() => onSelectNode?.(node)}
            >
              <div className={`rounded-xl border px-4 py-3 transition-all ${
                isSelected
                  ? 'border-claw-primary bg-claw-primary/5'
                  : 'border-claw-border bg-claw-card group-hover:border-claw-primary/30'
              }`}>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-claw-text">{node.nodeId}</span>
                    <span className="text-[10px] text-claw-muted bg-claw-input px-1.5 py-0.5 rounded">
                      {node.nodeType}
                    </span>
                  </div>
                  <span className={`text-xs font-medium ${cfg.color}`}>{statusLabel[node.status]}</span>
                </div>

                {/* Timing */}
                <div className="flex gap-4 text-[11px] text-claw-muted">
                  {node.startedAt && (
                    <span>开始: {new Date(node.startedAt).toLocaleTimeString()}</span>
                  )}
                  {node.completedAt && (
                    <span>结束: {new Date(node.completedAt).toLocaleTimeString()}</span>
                  )}
                  {node.startedAt && node.completedAt && (
                    <span className="text-claw-primary-light">
                      耗时: {((new Date(node.completedAt).getTime() - new Date(node.startedAt).getTime()) / 1000).toFixed(1)}s
                    </span>
                  )}
                </div>

                {/* Error message */}
                {node.errorMessage && (
                  <div className="mt-2 text-xs text-claw-danger bg-claw-danger/10 rounded-lg px-3 py-2 font-mono">
                    {node.errorMessage}
                  </div>
                )}

                {/* Output preview */}
                {node.outputJson && Object.keys(node.outputJson).length > 0 && (
                  <details className="mt-2">
                    <summary className="text-xs text-claw-muted cursor-pointer hover:text-claw-text">
                      查看输出
                    </summary>
                    <pre className="mt-1 text-[11px] text-claw-text bg-claw-input rounded-lg p-2 overflow-auto max-h-40 font-mono">
                      {JSON.stringify(node.outputJson, null, 2)}
                    </pre>
                  </details>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
