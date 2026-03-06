import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWorkflows, useDeleteWorkflow } from '../hooks/useWorkflows';
import { useMachines } from '../hooks/useMachines';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { PageSpinner } from '../components/ui/Spinner';
import { EmptyState } from '../components/ui/EmptyState';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { CreateWorkflowModal } from '../components/workflow/CreateWorkflowModal';
import { useCreateWorkflow } from '../hooks/useWorkflows';
import {
  Plus,
  Workflow,
  Play,
  Clock,
  MessageSquare,
  Globe,
  Zap,
  Trash2,
  Edit3,
  Server,
} from 'lucide-react';
import type { WorkflowStatus, TriggerType, Workflow as WorkflowType } from '../types/workflow';

const statusConfig: Record<WorkflowStatus, { label: string; variant: 'success' | 'warning' | 'danger' | 'muted' | 'info' }> = {
  draft: { label: '草稿', variant: 'muted' },
  active: { label: '运行中', variant: 'success' },
  disabled: { label: '已禁用', variant: 'warning' },
  archived: { label: '已归档', variant: 'muted' },
};

const triggerConfig: Record<TriggerType, { label: string; icon: typeof Play }> = {
  message: { label: '消息触发', icon: MessageSquare },
  schedule: { label: '定时触发', icon: Clock },
  webhook: { label: 'Webhook', icon: Globe },
  manual: { label: '手动触发', icon: Zap },
};

const statusFilters = [
  { id: 'all', label: '全部' },
  { id: 'draft', label: '草稿' },
  { id: 'active', label: '运行中' },
  { id: 'disabled', label: '已禁用' },
];

export function WorkflowsPage() {
  const navigate = useNavigate();
  const [filterStatus, setFilterStatus] = useState('all');
  const { data, isLoading } = useWorkflows(
    filterStatus !== 'all' ? { status: filterStatus } : undefined,
  );
  const { data: machinesData } = useMachines();
  const createWorkflow = useCreateWorkflow();
  const deleteWorkflow = useDeleteWorkflow();

  const [showCreate, setShowCreate] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<WorkflowType | null>(null);

  if (isLoading) return <PageSpinner />;

  const workflows = data?.data ?? [];
  const machines = (machinesData?.data ?? []).map((m) => ({ id: m.id, name: m.name }));

  function handleCreate(formData: {
    name: string;
    description: string;
    machineId: string;
    triggerType: TriggerType;
    channel?: string;
    pattern?: string;
    cron?: string;
  }) {
    createWorkflow.mutate(
      {
        name: formData.name,
        description: formData.description || undefined,
        machineId: formData.machineId,
        triggerConfig: {
          type: formData.triggerType,
          channel: formData.channel,
          pattern: formData.pattern,
          cron: formData.cron,
        },
        nodes: [],
        edges: [],
        createdBy: 'admin',
      },
      {
        onSuccess: (wf) => {
          setShowCreate(false);
          navigate(`/workflows/${wf.id}`);
        },
      },
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex justify-between items-center mb-5">
        <div className="flex gap-2 flex-wrap">
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
        <Button icon={<Plus size={16} />} onClick={() => setShowCreate(true)}>
          创建工作流
        </Button>
      </div>

      {workflows.length === 0 ? (
        <EmptyState
          icon={<Workflow size={48} />}
          title="暂无工作流"
          description="创建你的第一个工作流，定义自动化任务流程"
          action={
            <Button onClick={() => setShowCreate(true)} icon={<Plus size={16} />}>
              创建工作流
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {workflows.map((wf) => {
            const sCfg = statusConfig[wf.status];
            const tCfg = triggerConfig[wf.triggerConfig.type];
            const TriggerIcon = tCfg.icon;

            return (
              <Card
                key={wf.id}
                hover
                onClick={() => navigate(`/workflows/${wf.id}`)}
                className="group"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-claw-primary/20 to-claw-accent/20 flex items-center justify-center">
                      <Workflow size={20} className="text-claw-primary-light" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-claw-text group-hover:text-claw-primary-light transition-colors">
                        {wf.name}
                      </h3>
                      <span className="text-[11px] text-claw-muted font-mono">v{wf.version}</span>
                    </div>
                  </div>
                  <Badge variant={sCfg.variant}>{sCfg.label}</Badge>
                </div>

                {wf.description && (
                  <p className="text-xs text-claw-muted mb-3 line-clamp-2">{wf.description}</p>
                )}

                <div className="flex items-center gap-4 text-[11px] text-claw-muted">
                  <div className="flex items-center gap-1">
                    <TriggerIcon size={12} />
                    {tCfg.label}
                  </div>
                  <div className="flex items-center gap-1">
                    <Workflow size={12} />
                    {wf.nodes.length} 个节点
                  </div>
                  <div className="flex items-center gap-1">
                    <Server size={12} />
                    {wf.machineId.slice(0, 8)}
                  </div>
                </div>

                <div className="flex items-center justify-between mt-3 pt-3 border-t border-claw-border">
                  <span className="text-[10px] text-claw-muted">
                    {wf.deployedAt
                      ? `部署于 ${new Date(wf.deployedAt).toLocaleDateString()}`
                      : `创建于 ${new Date(wf.createdAt).toLocaleDateString()}`}
                  </span>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      className="p-1.5 rounded-lg hover:bg-claw-input text-claw-muted hover:text-claw-text transition-colors cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/workflows/${wf.id}`);
                      }}
                      title="编辑"
                    >
                      <Edit3 size={13} />
                    </button>
                    <button
                      className="p-1.5 rounded-lg hover:bg-claw-danger/10 text-claw-muted hover:text-claw-danger transition-colors cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteTarget(wf);
                      }}
                      title="删除"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <CreateWorkflowModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreate={handleCreate}
        machines={machines}
        loading={createWorkflow.isPending}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) {
            deleteWorkflow.mutate(deleteTarget.id, {
              onSuccess: () => setDeleteTarget(null),
            });
          }
        }}
        title="删除工作流"
        message={`确定要删除工作流「${deleteTarget?.name}」吗？此操作不可恢复。`}
        confirmLabel="删除"
        loading={deleteWorkflow.isPending}
      />
    </div>
  );
}
