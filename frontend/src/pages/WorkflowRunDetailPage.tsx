import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useWorkflowRun, useWorkflowRunNodes, useAbortRun } from '../hooks/useWorkflows';
import { RunTimeline } from '../components/workflow/RunTimeline';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { PageSpinner } from '../components/ui/Spinner';
import {
  ChevronLeft,
  Play,
  StopCircle,
  Clock,
  CheckCircle,
  XCircle,
  Pause,
  Loader2,
  AlertTriangle,
  Server,
  FileJson,
} from 'lucide-react';
import type { WorkflowRunStatus, WorkflowRunNode } from '../types/workflow';

const runStatusConfig: Record<WorkflowRunStatus, { label: string; variant: 'success' | 'warning' | 'danger' | 'muted' | 'info'; icon: typeof Play }> = {
  pending: { label: '等待中', variant: 'muted', icon: Clock },
  running: { label: '执行中', variant: 'info', icon: Loader2 },
  paused: { label: '已暂停', variant: 'warning', icon: Pause },
  completed: { label: '已完成', variant: 'success', icon: CheckCircle },
  failed: { label: '失败', variant: 'danger', icon: XCircle },
  aborted: { label: '已中止', variant: 'muted', icon: AlertTriangle },
};

export function WorkflowRunDetailPage() {
  const { runId } = useParams<{ runId: string }>();
  const { data: run, isLoading: loadingRun } = useWorkflowRun(runId!);
  const { data: nodesData, isLoading: loadingNodes } = useWorkflowRunNodes(runId!);
  const abortRun = useAbortRun();

  const [selectedNode, setSelectedNode] = useState<WorkflowRunNode | null>(null);

  if (loadingRun || !run) return <PageSpinner />;

  const nodes = nodesData?.data ?? [];
  const cfg = runStatusConfig[run.status];
  const StatusIcon = cfg.icon;

  return (
    <div>
      {/* Back link */}
      <Link
        to="/workflows/runs"
        className="inline-flex items-center gap-1 text-sm text-claw-muted hover:text-claw-text mb-4 transition-colors"
      >
        <ChevronLeft size={16} />
        返回运行记录
      </Link>

      {/* Header */}
      <Card className="mb-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-claw-primary/20 to-claw-accent/20 flex items-center justify-center">
              <StatusIcon
                size={24}
                className={`${cfg.variant === 'info' ? 'text-claw-primary-light animate-spin' : cfg.variant === 'success' ? 'text-claw-success' : cfg.variant === 'danger' ? 'text-claw-danger' : 'text-claw-muted'}`}
              />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-claw-text font-mono">{run.runId.slice(0, 12)}</h2>
                <Badge variant={cfg.variant}>{cfg.label}</Badge>
              </div>
              <div className="text-xs text-claw-muted mt-0.5">
                工作流 ID: <span className="font-mono">{run.workflowId.slice(0, 8)}</span>
              </div>
            </div>
          </div>

          {(run.status === 'running' || run.status === 'paused') && (
            <Button
              variant="danger"
              size="sm"
              icon={<StopCircle size={14} />}
              loading={abortRun.isPending}
              onClick={() => abortRun.mutate(run.id)}
            >
              中止运行
            </Button>
          )}
        </div>

        {/* Meta */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4 pt-4 border-t border-claw-border text-sm">
          <div className="flex items-center gap-2">
            <Server size={14} className="text-claw-muted shrink-0" />
            <div>
              <div className="text-claw-muted text-xs">节点</div>
              <div className="text-claw-text font-mono text-xs">{run.machineId.slice(0, 12)}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Clock size={14} className="text-claw-muted shrink-0" />
            <div>
              <div className="text-claw-muted text-xs">开始时间</div>
              <div className="text-claw-text text-xs">
                {run.startedAt ? new Date(run.startedAt).toLocaleString() : '-'}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <CheckCircle size={14} className="text-claw-muted shrink-0" />
            <div>
              <div className="text-claw-muted text-xs">完成时间</div>
              <div className="text-claw-text text-xs">
                {run.completedAt ? new Date(run.completedAt).toLocaleString() : '-'}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Play size={14} className="text-claw-muted shrink-0" />
            <div>
              <div className="text-claw-muted text-xs">当前节点</div>
              <div className="text-claw-text text-xs font-mono">
                {run.currentNodes?.join(', ') ?? '-'}
              </div>
            </div>
          </div>
        </div>

        {run.errorMessage && (
          <div className="mt-3 bg-claw-danger/10 rounded-lg px-4 py-3 text-xs text-claw-danger font-mono">
            {run.errorMessage}
          </div>
        )}
      </Card>

      {/* Content: Timeline + Detail */}
      <div className="flex gap-5">
        {/* Timeline */}
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-3">
            <h3 className="text-sm font-semibold text-claw-text">执行时间线</h3>
            <span className="text-[10px] text-claw-muted bg-claw-input px-2 py-0.5 rounded">
              {nodes.length} 个节点
            </span>
          </div>
          {loadingNodes ? (
            <PageSpinner />
          ) : (
            <RunTimeline
              nodes={nodes}
              onSelectNode={setSelectedNode}
              selectedNodeId={selectedNode?.nodeId}
            />
          )}
        </div>

        {/* Selected node detail */}
        {selectedNode && (
          <div className="w-80 shrink-0">
            <Card>
              <div className="flex items-center gap-2 mb-3">
                <FileJson size={14} className="text-claw-primary-light" />
                <span className="text-sm font-semibold text-claw-text">{selectedNode.nodeId}</span>
              </div>

              {selectedNode.inputJson && Object.keys(selectedNode.inputJson).length > 0 && (
                <div className="mb-3">
                  <div className="text-[10px] text-claw-muted mb-1 font-medium">输入</div>
                  <pre className="bg-claw-input rounded-lg p-3 text-[11px] text-claw-text font-mono overflow-auto max-h-40">
                    {JSON.stringify(selectedNode.inputJson, null, 2)}
                  </pre>
                </div>
              )}

              {selectedNode.outputJson && Object.keys(selectedNode.outputJson).length > 0 && (
                <div className="mb-3">
                  <div className="text-[10px] text-claw-muted mb-1 font-medium">输出</div>
                  <pre className="bg-claw-input rounded-lg p-3 text-[11px] text-claw-text font-mono overflow-auto max-h-40">
                    {JSON.stringify(selectedNode.outputJson, null, 2)}
                  </pre>
                </div>
              )}

              {selectedNode.errorMessage && (
                <div>
                  <div className="text-[10px] text-claw-danger mb-1 font-medium">错误信息</div>
                  <pre className="bg-claw-danger/10 rounded-lg p-3 text-[11px] text-claw-danger font-mono overflow-auto max-h-40">
                    {selectedNode.errorMessage}
                  </pre>
                </div>
              )}
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
