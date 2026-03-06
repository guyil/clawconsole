import { Badge } from '../ui/Badge';
import type { SyncOperationStatus } from '../../types/sync';

const statusConfig: Record<SyncOperationStatus, { label: string; variant: 'success' | 'warning' | 'danger' | 'info' | 'muted' }> = {
  completed: { label: '已完成', variant: 'success' },
  in_progress: { label: '进行中', variant: 'info' },
  pending: { label: '待执行', variant: 'muted' },
  partial_failure: { label: '部分失败', variant: 'warning' },
  failed: { label: '失败', variant: 'danger' },
};

export function SyncStatusBadge({ status }: { status: SyncOperationStatus }) {
  const cfg = statusConfig[status] ?? { label: status, variant: 'muted' as const };
  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
}
