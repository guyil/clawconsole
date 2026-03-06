import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWorkflows } from '../hooks/useWorkflows';
import { workflowsApi } from '../api/workflows.api';
import { useQuery } from '@tanstack/react-query';
import { DataTable } from '../components/ui/DataTable';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { PageSpinner } from '../components/ui/Spinner';
import { EmptyState } from '../components/ui/EmptyState';
import {
  Play,
  Eye,
  StopCircle,
  Clock,
  CheckCircle,
  XCircle,
  Pause,
  Loader2,
  AlertTriangle,
} from 'lucide-react';
import type { WorkflowRunStatus, WorkflowRun } from '../types/workflow';

const runStatusConfig: Record<WorkflowRunStatus, { label: string; variant: 'success' | 'warning' | 'danger' | 'muted' | 'info'; icon: typeof Play }> = {
  pending: { label: '等待中', variant: 'muted', icon: Clock },
  running: { label: '执行中', variant: 'info', icon: Loader2 },
  paused: { label: '已暂停', variant: 'warning', icon: Pause },
  completed: { label: '已完成', variant: 'success', icon: CheckCircle },
  failed: { label: '失败', variant: 'danger', icon: XCircle },
  aborted: { label: '已中止', variant: 'muted', icon: AlertTriangle },
};

const statusFilters = [
  { id: 'all', label: '全部' },
  { id: 'running', label: '执行中' },
  { id: 'paused', label: '已暂停' },
  { id: 'completed', label: '已完成' },
  { id: 'failed', label: '失败' },
];

export function WorkflowRunsPage() {
  const navigate = useNavigate();
  const [filterStatus, setFilterStatus] = useState('all');
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>('');

  const { data: workflowsData, isLoading: loadingWorkflows } = useWorkflows();
  const workflows = workflowsData?.data ?? [];

  const { data: runsData, isLoading: loadingRuns } = useQuery({
    queryKey: ['workflow-runs', selectedWorkflowId, filterStatus],
    queryFn: () =>
      workflowsApi.listRuns(
        selectedWorkflowId,
        filterStatus !== 'all' ? { status: filterStatus } : undefined,
      ),
    enabled: !!selectedWorkflowId,
  });

  if (loadingWorkflows) return <PageSpinner />;

  const runs = runsData?.data ?? [];

  return (
    <div>
      {/* Filters */}
      <div className="flex items-center gap-4 mb-5 flex-wrap">
        <div>
          <select
            className="bg-claw-input border border-claw-border rounded-lg px-3 py-2 text-sm text-claw-text focus:border-claw-primary focus:outline-none min-w-[200px]"
            value={selectedWorkflowId}
            onChange={(e) => setSelectedWorkflowId(e.target.value)}
          >
            <option value="">选择工作流...</option>
            {workflows.map((wf) => (
              <option key={wf.id} value={wf.id}>{wf.name}</option>
            ))}
          </select>
        </div>

        <div className="flex gap-2">
          {statusFilters.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilterStatus(f.id)}
              className={`px-4 py-1.5 rounded-full text-[13px] cursor-pointer border transition-all ${
                filterStatus === f.id
                  ? 'bg-claw-primary text-white border-claw-primary'
                  : 'bg-claw-card text-claw-muted border-claw-border hover:border-claw-primary'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {!selectedWorkflowId ? (
        <EmptyState
          icon={<Play size={48} />}
          title="选择工作流"
          description="选择一个工作流以查看其运行记录"
        />
      ) : loadingRuns ? (
        <PageSpinner />
      ) : runs.length === 0 ? (
        <EmptyState
          icon={<Play size={48} />}
          title="暂无运行记录"
          description="此工作流尚无执行记录"
        />
      ) : (
        <DataTable<WorkflowRun>
          columns={[
            {
              key: 'runId',
              header: '运行 ID',
              width: '1.5fr',
              render: (r) => (
                <span className="text-sm text-claw-text font-mono">{r.runId.slice(0, 12)}</span>
              ),
            },
            {
              key: 'status',
              header: '状态',
              width: '1fr',
              render: (r) => {
                const cfg = runStatusConfig[r.status];
                const Icon = cfg.icon;
                return (
                  <div className="flex items-center gap-1.5">
                    <Icon size={13} className={r.status === 'running' ? 'animate-spin text-claw-primary-light' : ''} />
                    <Badge variant={cfg.variant}>{cfg.label}</Badge>
                  </div>
                );
              },
            },
            {
              key: 'currentNodes',
              header: '当前节点',
              width: '1fr',
              render: (r) => (
                <span className="text-xs text-claw-muted font-mono">
                  {r.currentNodes?.join(', ') ?? '-'}
                </span>
              ),
            },
            {
              key: 'startedAt',
              header: '开始时间',
              width: '1fr',
              render: (r) => (
                <span className="text-xs text-claw-muted">
                  {r.startedAt ? new Date(r.startedAt).toLocaleString() : '-'}
                </span>
              ),
            },
            {
              key: 'duration',
              header: '耗时',
              width: '0.8fr',
              render: (r) => {
                if (!r.startedAt) return <span className="text-xs text-claw-muted">-</span>;
                const end = r.completedAt ? new Date(r.completedAt).getTime() : Date.now();
                const seconds = Math.round((end - new Date(r.startedAt).getTime()) / 1000);
                return (
                  <span className="text-xs text-claw-muted">
                    {seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`}
                  </span>
                );
              },
            },
            {
              key: 'actions',
              header: '操作',
              width: '1fr',
              render: (r) => (
                <div className="flex gap-1.5">
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<Eye size={13} />}
                    onClick={() => navigate(`/workflows/runs/${r.id}`)}
                  >
                    详情
                  </Button>
                  {(r.status === 'running' || r.status === 'paused') && (
                    <Button
                      variant="danger"
                      size="sm"
                      icon={<StopCircle size={13} />}
                    >
                      中止
                    </Button>
                  )}
                </div>
              ),
            },
          ]}
          data={runs}
        />
      )}
    </div>
  );
}
