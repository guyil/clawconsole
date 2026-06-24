import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSkills, useReviewSkill, useSkillTags } from '../hooks/useSkills';
import { useIsAdmin } from '../stores/auth.store';
import { DataTable } from '../components/ui/DataTable';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { PageSpinner } from '../components/ui/Spinner';
import { EmptyState } from '../components/ui/EmptyState';
import { AddSkillModal } from '../components/skills/AddSkillModal';
import { ImportUrlModal } from '../components/skills/ImportUrlModal';
import { ImportLocalModal } from '../components/skills/ImportLocalModal';
import { DeploySkillModal } from '../components/skills/DeploySkillModal';
import { Plus, Link2, FolderOpen, Puzzle, Send, Eye, CheckCircle, XCircle, Tag, X } from 'lucide-react';
import type { SkillCatalogEntry, SkillReviewStatus } from '../types/skill';

const reviewStatusConfig: Record<SkillReviewStatus, { label: string; variant: 'success' | 'warning' | 'danger' | 'muted' }> = {
  approved: { label: '已审核', variant: 'success' },
  pending: { label: '待审核', variant: 'warning' },
  rejected: { label: '已拒绝', variant: 'danger' },
  deprecated: { label: '已弃用', variant: 'muted' },
};

const sourceLabels: Record<string, string> = {
  custom: '自定义',
  clawhub: 'ClawHub',
  bundled: '内置',
  local: '本地文件夹',
};

export function SkillsPage() {
  const navigate = useNavigate();
  const isAdmin = useIsAdmin();
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterTag, setFilterTag] = useState<string>('');

  const listParams: Record<string, string> = {};
  if (filterStatus !== 'all') listParams.reviewStatus = filterStatus;
  if (filterTag) listParams.tag = filterTag;

  const { data, isLoading } = useSkills(
    Object.keys(listParams).length > 0 ? listParams : undefined,
  );
  const { data: tagsData } = useSkillTags();
  const review = useReviewSkill();

  const [showAdd, setShowAdd] = useState(false);
  const [showImportUrl, setShowImportUrl] = useState(false);
  const [showImportLocal, setShowImportLocal] = useState(false);
  const [deploySkill, setDeploySkill] = useState<{ id: string; name: string } | null>(null);

  if (isLoading) return <PageSpinner />;

  const skills = data?.data ?? [];
  const allTags = tagsData?.data ?? [];

  const statusFilters = [
    { id: 'all', label: '全部' },
    { id: 'approved', label: '已审核' },
    { id: 'pending', label: '待审核' },
    { id: 'rejected', label: '已拒绝' },
  ];

  return (
    <div>
      {/* Header */}
      <div className="flex justify-between items-center mb-3">
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
        {isAdmin && (
          <div className="flex gap-2">
            <Button variant="secondary" icon={<FolderOpen size={16} />} onClick={() => setShowImportLocal(true)}>
              从本地导入
            </Button>
            <Button variant="secondary" icon={<Link2 size={16} />} onClick={() => setShowImportUrl(true)}>
              从 URL 导入
            </Button>
            <Button icon={<Plus size={16} />} onClick={() => setShowAdd(true)}>
              添加 Skill
            </Button>
          </div>
        )}
      </div>

      {/* Tag filter */}
      {allTags.length > 0 && (
        <div className="flex items-center gap-2 mb-5 flex-wrap">
          <Tag size={14} className="text-claw-muted shrink-0" />
          {allTags.map((t) => (
            <button
              key={t}
              onClick={() => setFilterTag(filterTag === t ? '' : t)}
              className={`px-3 py-1 rounded-full text-xs cursor-pointer border transition-all ${
                filterTag === t
                  ? 'bg-claw-accent/20 text-claw-accent border-claw-accent'
                  : 'bg-claw-card text-claw-muted border-claw-border hover:border-claw-accent/50'
              }`}
            >
              {t}
            </button>
          ))}
          {filterTag && (
            <button
              onClick={() => setFilterTag('')}
              className="text-claw-muted hover:text-claw-text transition-colors cursor-pointer"
              title="清除标签筛选"
            >
              <X size={14} />
            </button>
          )}
        </div>
      )}

      {skills.length === 0 ? (
        <EmptyState
          icon={<Puzzle size={48} />}
          title="暂无 Skills"
          description={isAdmin ? '添加你的第一个 Skill 开始管理' : '目录中暂无 Skill'}
          action={
            isAdmin ? (
              <Button onClick={() => setShowAdd(true)} icon={<Plus size={16} />}>
                添加 Skill
              </Button>
            ) : undefined
          }
        />
      ) : (
        <DataTable<SkillCatalogEntry>
          columns={[
            {
              key: 'name',
              header: 'Skill 名称',
              width: '2fr',
              render: (s) => (
                <div
                  className="cursor-pointer group"
                  onClick={() => navigate(`/skills/${s.id}`)}
                >
                  <span className="text-claw-text font-medium text-sm group-hover:text-claw-primary-light transition-colors">
                    ⬡ {s.name}
                  </span>
                  <div className="text-xs text-claw-muted mt-0.5">{s.skillKey}</div>
                </div>
              ),
            },
            {
              key: 'source',
              header: '来源',
              width: '0.8fr',
              render: (s) => (
                <span className="text-claw-muted text-[13px]">
                  {sourceLabels[s.source] ?? s.source}
                </span>
              ),
            },
            {
              key: 'tags',
              header: '标签',
              width: '1.2fr',
              render: (s) => (
                <div className="flex gap-1 flex-wrap">
                  {s.tags && s.tags.length > 0 ? (
                    s.tags.map((tag) => (
                      <span
                        key={tag}
                        onClick={(e) => {
                          e.stopPropagation();
                          setFilterTag(filterTag === tag ? '' : tag);
                        }}
                        className="px-2 py-0.5 bg-claw-accent/10 text-claw-accent border border-claw-accent/20 rounded-full text-[11px] cursor-pointer hover:bg-claw-accent/20 transition-colors"
                      >
                        {tag}
                      </span>
                    ))
                  ) : (
                    <span className="text-claw-muted/50 text-[11px]">-</span>
                  )}
                </div>
              ),
            },
            {
              key: 'scope',
              header: '范围',
              width: '0.8fr',
              render: (s) => (
                <Badge variant="muted">{s.scope === 'global' ? '全局' : 'Agent'}</Badge>
              ),
            },
            {
              key: 'status',
              header: '审核状态',
              width: '1fr',
              render: (s) => {
                const cfg = reviewStatusConfig[s.reviewStatus];
                return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
              },
            },
            {
              key: 'version',
              header: '版本',
              width: '0.8fr',
              render: (s) => (
                <span className="text-claw-muted text-[13px]">{s.version ?? '-'}</span>
              ),
            },
            {
              key: 'actions',
              header: '操作',
              width: '1.5fr',
              render: (s) => (
                <div className="flex gap-1.5">
                  {isAdmin && s.reviewStatus === 'pending' && (
                    <>
                      <Button
                        variant="primary"
                        size="sm"
                        icon={<CheckCircle size={13} />}
                        onClick={() =>
                          review.mutate({ id: s.id, action: 'approve', reviewedBy: 'admin' })
                        }
                      >
                        通过
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        icon={<XCircle size={13} />}
                        onClick={() =>
                          review.mutate({ id: s.id, action: 'reject', reviewedBy: 'admin' })
                        }
                      />
                    </>
                  )}
                  {isAdmin && s.reviewStatus === 'approved' && (
                    <Button
                      variant="primary"
                      size="sm"
                      icon={<Send size={13} />}
                      onClick={() => setDeploySkill({ id: s.id, name: s.name })}
                    >
                      部署
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<Eye size={13} />}
                    onClick={() => navigate(`/skills/${s.id}`)}
                  >
                    详情
                  </Button>
                </div>
              ),
            },
          ]}
          data={skills}
        />
      )}

      <AddSkillModal open={showAdd} onClose={() => setShowAdd(false)} />
      <ImportUrlModal open={showImportUrl} onClose={() => setShowImportUrl(false)} />
      <ImportLocalModal open={showImportLocal} onClose={() => setShowImportLocal(false)} />
      {deploySkill && (
        <DeploySkillModal
          open={!!deploySkill}
          onClose={() => setDeploySkill(null)}
          skillId={deploySkill.id}
          skillName={deploySkill.name}
        />
      )}
    </div>
  );
}
