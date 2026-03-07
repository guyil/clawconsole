import { useState } from 'react';
import { Clock, UserCheck, CheckCircle, XCircle, MessageSquare } from 'lucide-react';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import type { WorkflowReview, ReviewStatus } from '../../types/workflow';

const statusConfig: Record<ReviewStatus, { label: string; variant: 'success' | 'warning' | 'danger' | 'muted' | 'info' }> = {
  pending: { label: '待审核', variant: 'warning' },
  approved: { label: '已批准', variant: 'success' },
  rejected: { label: '已拒绝', variant: 'danger' },
  escalated: { label: '已升级', variant: 'info' },
  expired: { label: '已过期', variant: 'muted' },
};

interface ReviewCardProps {
  review: WorkflowReview;
  onDecide: (decision: 'approved' | 'rejected', comments?: string) => void;
  loading?: boolean;
}

export function ReviewCard({ review, onDecide, loading }: ReviewCardProps) {
  const [showComment, setShowComment] = useState(false);
  const [comment, setComment] = useState('');
  const cfg = statusConfig[review.status];

  const isPending = review.status === 'pending';
  const timeoutDate = review.timeoutAt ? new Date(review.timeoutAt) : null;
  const isExpiringSoon = timeoutDate && timeoutDate.getTime() - Date.now() < 3600_000;

  return (
    <Card className="mb-3">
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-claw-warning/15 flex items-center justify-center shrink-0">
            <UserCheck size={20} className="text-claw-warning" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-claw-text">节点: {review.nodeId}</span>
              <Badge variant={cfg.variant}>{cfg.label}</Badge>
            </div>
            <div className="text-xs text-claw-muted mt-0.5">
              运行 ID: <span className="font-mono">{review.runId.slice(0, 8)}</span>
              <span className="mx-2">·</span>
              策略: {review.policy === 'any' ? '任一通过' : '全部通过'}
              <span className="mx-2">·</span>
              审核人: {review.reviewers.map((r) => r.userId ?? r.role ?? r.group).join(', ')}
            </div>
          </div>
        </div>

        {timeoutDate && (
          <div className={`flex items-center gap-1 text-xs shrink-0 ${isExpiringSoon ? 'text-claw-danger' : 'text-claw-muted'}`}>
            <Clock size={12} />
            {timeoutDate.toLocaleString()}
          </div>
        )}
      </div>

      {/* Payload */}
      {review.payload && Object.keys(review.payload).length > 0 && (
        <div className="mt-3 bg-claw-input rounded-lg p-3">
          <div className="text-[10px] text-claw-muted mb-1 font-medium">审核内容</div>
          <pre className="text-xs text-claw-text font-mono overflow-auto max-h-32">
            {JSON.stringify(review.payload, null, 2)}
          </pre>
        </div>
      )}

      {/* Decision area */}
      {isPending && (
        <div className="mt-4 pt-3 border-t border-claw-border">
          {showComment && (
            <div className="mb-3">
              <textarea
                className="w-full bg-claw-input border border-claw-border rounded-lg px-3 py-2 text-sm text-claw-text focus:border-claw-primary focus:outline-none resize-none"
                rows={2}
                placeholder="审核备注（可选）..."
                value={comment}
                onChange={(e) => setComment(e.target.value)}
              />
            </div>
          )}

          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              icon={<CheckCircle size={14} />}
              loading={loading}
              onClick={() => onDecide('approved', comment || undefined)}
            >
              批准
            </Button>
            <Button
              variant="danger"
              size="sm"
              icon={<XCircle size={14} />}
              loading={loading}
              onClick={() => onDecide('rejected', comment || undefined)}
            >
              拒绝
            </Button>
            <button
              className="ml-auto flex items-center gap-1 text-xs text-claw-muted hover:text-claw-text cursor-pointer"
              onClick={() => setShowComment(!showComment)}
            >
              <MessageSquare size={12} />
              {showComment ? '收起备注' : '添加备注'}
            </button>
          </div>
        </div>
      )}

      {/* Already decided */}
      {review.decision && (
        <div className="mt-3 pt-3 border-t border-claw-border text-xs text-claw-muted">
          <span>决定: </span>
          <span className={review.decision === 'approved' ? 'text-claw-success' : 'text-claw-danger'}>
            {review.decision === 'approved' ? '已批准' : '已拒绝'}
          </span>
          {review.decidedBy && <span className="ml-2">by {review.decidedBy}</span>}
          {review.comments && <span className="ml-2 text-claw-text">"{review.comments}"</span>}
        </div>
      )}
    </Card>
  );
}
