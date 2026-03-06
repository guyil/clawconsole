import { usePendingReviews, useSubmitReviewDecision } from '../hooks/useWorkflows';
import { ReviewCard } from '../components/workflow/ReviewCard';
import { PageSpinner } from '../components/ui/Spinner';
import { EmptyState } from '../components/ui/EmptyState';
import { UserCheck, Inbox } from 'lucide-react';

export function ReviewInboxPage() {
  const { data, isLoading } = usePendingReviews();
  const submitDecision = useSubmitReviewDecision();

  if (isLoading) return <PageSpinner />;

  const reviews = data?.data ?? [];
  const pendingCount = reviews.filter((r) => r.status === 'pending').length;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-claw-warning/15 flex items-center justify-center">
            <UserCheck size={18} className="text-claw-warning" />
          </div>
          <div>
            <h2 className="text-base font-bold text-claw-text">审核收件箱</h2>
            <span className="text-xs text-claw-muted">
              {pendingCount > 0 ? `${pendingCount} 条待处理` : '暂无待审核项'}
            </span>
          </div>
        </div>
      </div>

      {reviews.length === 0 ? (
        <EmptyState
          icon={<Inbox size={48} />}
          title="收件箱为空"
          description="暂无需要审核的工作流节点"
        />
      ) : (
        <div className="max-w-2xl">
          {reviews.map((review) => (
            <ReviewCard
              key={review.id}
              review={review}
              onDecide={(decision, comments) =>
                submitDecision.mutate({
                  runId: review.runId,
                  nodeId: review.nodeId,
                  decision,
                  decidedBy: 'admin',
                  comments,
                })
              }
              loading={submitDecision.isPending}
            />
          ))}
        </div>
      )}
    </div>
  );
}
