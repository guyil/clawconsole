import { useSyncOperations, useRetrySync } from '../../hooks/useSync';
import { SyncStatusBadge } from './SyncStatusBadge';
import { Button } from '../ui/Button';
import { RotateCcw } from 'lucide-react';
import type { SyncOperationStatus } from '../../types/sync';

interface Props {
  machineId: string;
}

export function SyncHistoryTable({ machineId }: Props) {
  const { data, isLoading } = useSyncOperations(machineId, { pageSize: 20 });
  const retrySync = useRetrySync();

  if (isLoading) return <div className="text-claw-muted text-sm py-4">加载中...</div>;

  const operations = data?.data ?? [];

  if (operations.length === 0) {
    return <div className="text-claw-muted text-sm py-4">暂无同步记录</div>;
  }

  return (
    <div className="space-y-2">
      {operations.map((op) => (
        <div
          key={op.id}
          className="bg-claw-card border border-claw-border rounded-lg px-4 py-3 flex items-center justify-between"
        >
          <div className="flex items-center gap-3">
            <SyncStatusBadge status={op.status as SyncOperationStatus} />
            <div>
              <div className="text-sm text-claw-text">
                {op.syncDirection === 'pull' ? '拉取' : op.syncDirection === 'push' ? '推送' : '双向'}
              </div>
              <div className="text-xs text-claw-muted">
                {op.startedAt ? new Date(op.startedAt).toLocaleString() : '-'}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-claw-muted">
              {op.syncedFiles}/{op.totalFiles}
            </span>
            {(op.status === 'failed' || op.status === 'partial_failure') && (
              <Button
                variant="ghost"
                size="sm"
                icon={<RotateCcw size={14} />}
                onClick={() => retrySync.mutate(op.id)}
              />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
