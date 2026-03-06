import { Modal } from '../ui/Modal';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { useReviewSkill, useDeleteSkill } from '../../hooks/useSkills';
import type { SkillCatalogEntry } from '../../types/skill';

interface Props {
  open: boolean;
  onClose: () => void;
  skill: SkillCatalogEntry | null;
}

const reviewStatusMap: Record<string, { label: string; variant: 'success' | 'warning' | 'danger' | 'muted' }> = {
  approved: { label: '已审核', variant: 'success' },
  pending: { label: '待审核', variant: 'warning' },
  rejected: { label: '已拒绝', variant: 'danger' },
  deprecated: { label: '已弃用', variant: 'muted' },
};

export function SkillDetailModal({ open, onClose, skill }: Props) {
  const review = useReviewSkill();
  const deleteSkill = useDeleteSkill();

  if (!skill) return null;

  const statusCfg = reviewStatusMap[skill.reviewStatus] ?? { label: skill.reviewStatus, variant: 'muted' as const };

  return (
    <Modal open={open} onClose={onClose} title={skill.name} width="max-w-2xl">
      <div className="space-y-4">
        {/* Meta info */}
        <div className="flex gap-2 flex-wrap">
          <Badge variant={statusCfg.variant}>{statusCfg.label}</Badge>
          <Badge variant="muted">{skill.scope}</Badge>
          <Badge variant="muted">{skill.source}</Badge>
          {skill.version && <Badge variant="info">v{skill.version}</Badge>}
        </div>

        {skill.description && (
          <p className="text-sm text-claw-muted">{skill.description}</p>
        )}

        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-claw-muted">Skill Key: </span>
            <span className="text-claw-text font-mono">{skill.skillKey}</span>
          </div>
          <div>
            <span className="text-claw-muted">创建时间: </span>
            <span className="text-claw-text">{new Date(skill.createdAt).toLocaleString()}</span>
          </div>
          {skill.requiresBins && skill.requiresBins.length > 0 && (
            <div>
              <span className="text-claw-muted">依赖命令: </span>
              <span className="text-claw-text">{skill.requiresBins.join(', ')}</span>
            </div>
          )}
          {skill.requiresEnv && skill.requiresEnv.length > 0 && (
            <div>
              <span className="text-claw-muted">环境变量: </span>
              <span className="text-claw-text">{skill.requiresEnv.join(', ')}</span>
            </div>
          )}
        </div>

        {/* SKILL.md content */}
        {skill.skillMdContent && (
          <div>
            <label className="block text-xs text-claw-muted mb-1">SKILL.md</label>
            <pre className="bg-claw-input border border-claw-border rounded-lg p-3 text-xs text-claw-text overflow-auto max-h-60 font-mono">
              {skill.skillMdContent}
            </pre>
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-between pt-2 border-t border-claw-border">
          <div className="flex gap-2">
            {skill.reviewStatus === 'pending' && (
              <>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() =>
                    review.mutate(
                      { id: skill.id, action: 'approve', reviewedBy: 'admin' },
                      { onSuccess: onClose },
                    )
                  }
                  loading={review.isPending}
                >
                  审核通过
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() =>
                    review.mutate(
                      { id: skill.id, action: 'reject', reviewedBy: 'admin' },
                      { onSuccess: onClose },
                    )
                  }
                  loading={review.isPending}
                >
                  拒绝
                </Button>
              </>
            )}
          </div>
          <Button
            variant="danger"
            size="sm"
            onClick={() => deleteSkill.mutate(skill.id, { onSuccess: onClose })}
            loading={deleteSkill.isPending}
          >
            删除 Skill
          </Button>
        </div>
      </div>
    </Modal>
  );
}
