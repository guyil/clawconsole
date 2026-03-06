import { useState } from 'react';
import { useSyncOperations, usePull, usePush, useFullSync, useRetrySync } from '../../hooks/useSync';
import { SyncStatusBadge } from '../sync/SyncStatusBadge';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { Download, Upload, RefreshCw, RotateCcw } from 'lucide-react';
import type { SyncOperationStatus } from '../../types/sync';

interface Props {
  machineId: string;
}

export function SyncPanel({ machineId }: Props) {
  const [page] = useState(1);
  const { data, isLoading } = useSyncOperations(machineId, { page, pageSize: 10 });
  const pull = usePull();
  const push = usePush();
  const fullSync = useFullSync();
  const retrySync = useRetrySync();

  const operations = data?.data ?? [];

  return (
    <div>
      {/* Action buttons */}
      <div className="flex gap-3 mb-5">
        <Button
          icon={<Download size={16} />}
          onClick={() => pull.mutate(machineId)}
          loading={pull.isPending}
          variant="secondary"
        >
          拉取远程
        </Button>
        <Button
          icon={<Upload size={16} />}
          onClick={() => push.mutate({ machineId })}
          loading={push.isPending}
          variant="secondary"
        >
          推送本地
        </Button>
        <Button
          icon={<RefreshCw size={16} />}
          onClick={() => fullSync.mutate(machineId)}
          loading={fullSync.isPending}
        >
          全量同步
        </Button>
      </div>

      {/* Operations history */}
      <div className="text-sm font-semibold text-claw-text mb-3">同步历史</div>
      {isLoading ? (
        <div className="text-claw-muted text-sm py-4">加载中...</div>
      ) : operations.length === 0 ? (
        <div className="text-claw-muted text-sm py-4">暂无同步记录</div>
      ) : (
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
                    {op.syncDirection === 'pull' ? '拉取' : op.syncDirection === 'push' ? '推送' : '双向同步'}
                    {' · '}
                    <span className="text-claw-muted">{op.syncType}</span>
                  </div>
                  <div className="text-xs text-claw-muted mt-0.5">
                    {op.startedAt ? new Date(op.startedAt).toLocaleString() : '-'}
                    {op.durationMs !== null && ` · ${(op.durationMs / 1000).toFixed(1)}s`}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-xs text-claw-muted">
                  {op.syncedFiles}/{op.totalFiles} 文件
                  {op.failedFiles > 0 && (
                    <span className="text-claw-danger ml-1">({op.failedFiles} 失败)</span>
                  )}
                </div>
                {(op.status === 'failed' || op.status === 'partial_failure') && (
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<RotateCcw size={14} />}
                    onClick={() => retrySync.mutate(op.id)}
                    loading={retrySync.isPending}
                  >
                    重试
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
