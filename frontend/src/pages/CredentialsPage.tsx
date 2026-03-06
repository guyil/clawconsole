import { useState } from 'react';
import {
  useCredentials,
  useDeleteCredential,
  useSyncCredential,
} from '../hooks/useCredentials';
import { useMachines } from '../hooks/useMachines';
import { CredentialCard } from '../components/credentials/CredentialCard';
import { CredentialFormModal } from '../components/credentials/CredentialFormModal';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { PageSpinner } from '../components/ui/Spinner';
import { Plus, KeyRound } from 'lucide-react';
import type { Credential } from '../types/credential';

export function CredentialsPage() {
  const { data, isLoading } = useCredentials();
  const { data: machinesData } = useMachines();
  const deleteCred = useDeleteCredential();
  const syncCred = useSyncCredential();

  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<Credential | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  if (isLoading) return <PageSpinner />;

  const credentials = data?.data ?? [];
  const machines = machinesData?.data ?? [];

  const getMachineName = (machineId: string | null) => {
    if (!machineId) return undefined;
    return machines.find((m) => m.id === machineId)?.name;
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-5">
        <div className="text-[13px] text-claw-muted">共 {credentials.length} 个凭证</div>
        <Button icon={<Plus size={16} />} onClick={() => setShowForm(true)}>
          新建凭证
        </Button>
      </div>

      {credentials.length === 0 ? (
        <EmptyState
          icon={<KeyRound size={48} />}
          title="暂无凭证"
          description="创建 API Key 或密钥进行安全管理"
          action={
            <Button onClick={() => setShowForm(true)} icon={<Plus size={16} />}>
              新建凭证
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {credentials.map((cred) => (
            <CredentialCard
              key={cred.id}
              credential={cred}
              machineName={getMachineName(cred.machineId)}
              onEdit={() => {
                setEditTarget(cred);
                setShowForm(true);
              }}
              onDelete={() => setDeleteTarget(cred.id)}
              onSync={() => {
                if (cred.machineId) {
                  syncCred.mutate({ credentialId: cred.id, machineId: cred.machineId });
                }
              }}
              syncLoading={syncCred.isPending}
            />
          ))}
        </div>
      )}

      <CredentialFormModal
        open={showForm}
        onClose={() => {
          setShowForm(false);
          setEditTarget(null);
        }}
        credential={editTarget}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) {
            deleteCred.mutate(deleteTarget, { onSuccess: () => setDeleteTarget(null) });
          }
        }}
        title="删除凭证"
        message="确定要删除该凭证吗？此操作不可恢复。"
        confirmLabel="删除"
        loading={deleteCred.isPending}
      />
    </div>
  );
}
