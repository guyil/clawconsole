import { useState } from 'react';
import { useMachines, useHealthCheck, useDiscover, useDeleteMachine } from '../hooks/useMachines';
import { MachineCard } from '../components/machines/MachineCard';
import { RegisterMachineModal } from '../components/machines/RegisterMachineModal';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { PageSpinner } from '../components/ui/Spinner';
import { Plus, Server } from 'lucide-react';

export function MachinesPage() {
  const { data, isLoading } = useMachines();
  const healthCheck = useHealthCheck();
  const discover = useDiscover();
  const deleteMachine = useDeleteMachine();

  const [showRegister, setShowRegister] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  if (isLoading) return <PageSpinner />;

  const machines = data?.data ?? [];

  return (
    <div>
      <div className="flex justify-between items-center mb-5">
        <div className="text-[13px] text-claw-muted">共 {machines.length} 个节点</div>
        <Button icon={<Plus size={16} />} onClick={() => setShowRegister(true)}>
          注册节点
        </Button>
      </div>

      {machines.length === 0 ? (
        <EmptyState
          icon={<Server size={48} />}
          title="暂无注册节点"
          description="注册一个 OpenClaw 节点开始管理 Bot"
          action={
            <Button onClick={() => setShowRegister(true)} icon={<Plus size={16} />}>
              注册第一个节点
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {machines.map((m) => (
            <MachineCard
              key={m.id}
              machine={m}
              onHealthCheck={(id) => healthCheck.mutate(id)}
              onDiscover={(id) => discover.mutate(id)}
              onDelete={(id) => setDeleteTarget(id)}
              healthCheckLoading={healthCheck.isPending}
              discoverLoading={discover.isPending}
            />
          ))}
        </div>
      )}

      <RegisterMachineModal open={showRegister} onClose={() => setShowRegister(false)} />

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) {
            deleteMachine.mutate(deleteTarget, { onSuccess: () => setDeleteTarget(null) });
          }
        }}
        title="删除节点"
        message="确定要删除该节点吗？此操作只会移除 Console 数据库中的记录，不会影响远程机器上的文件。"
        confirmLabel="删除"
        loading={deleteMachine.isPending}
      />
    </div>
  );
}
