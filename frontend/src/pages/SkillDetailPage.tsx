import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useSkill, useReviewSkill, useDeleteSkill } from '../hooks/useSkills';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { PageSpinner } from '../components/ui/Spinner';
import { DeploySkillModal } from '../components/skills/DeploySkillModal';
import {
  ChevronLeft,
  Puzzle,
  Send,
  CheckCircle,
  XCircle,
  Trash2,
  FileText,
  Terminal,
  Key,
  Clock,
  Tag,
  Globe,
  User,
  Copy,
  Check,
} from 'lucide-react';
import type { SkillReviewStatus } from '../types/skill';

const reviewStatusConfig: Record<
  SkillReviewStatus,
  { label: string; variant: 'success' | 'warning' | 'danger' | 'muted' }
> = {
  approved: { label: '已审核', variant: 'success' },
  pending: { label: '待审核', variant: 'warning' },
  rejected: { label: '已拒绝', variant: 'danger' },
  deprecated: { label: '已弃用', variant: 'muted' },
};

const sourceLabels: Record<string, string> = {
  custom: '自定义',
  clawhub: 'ClawHub',
  bundled: '内置',
};

export function SkillDetailPage() {
  const { skillId } = useParams<{ skillId: string }>();
  const { data: skill, isLoading } = useSkill(skillId!);
  const review = useReviewSkill();
  const deleteSkill = useDeleteSkill();
  const navigate = useNavigate();

  const [deployOpen, setDeployOpen] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [activeFileTab, setActiveFileTab] = useState<string | null>(null);

  if (isLoading || !skill) return <PageSpinner />;

  const statusCfg = reviewStatusConfig[skill.reviewStatus];
  const auxFiles = skill.auxiliaryFiles ?? {};
  const auxFileNames = Object.keys(auxFiles);
  const activeAuxFile = activeFileTab ?? auxFileNames[0] ?? null;

  function copyToClipboard(text: string, field: string) {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  }

  function handleDelete() {
    if (!confirm('确定要删除此 Skill 吗？')) return;
    deleteSkill.mutate(skill!.id, {
      onSuccess: () => navigate('/skills'),
    });
  }

  return (
    <div>
      {/* Back link */}
      <Link
        to="/skills"
        className="inline-flex items-center gap-1 text-sm text-claw-muted hover:text-claw-text mb-4 transition-colors"
      >
        <ChevronLeft size={16} />
        返回 Skills 中心
      </Link>

      {/* Header card */}
      <Card className="mb-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-claw-primary/25 to-claw-accent/25 flex items-center justify-center">
              <Puzzle size={24} className="text-claw-primary-light" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-claw-text">{skill.name}</h2>
                <Badge variant={statusCfg.variant}>{statusCfg.label}</Badge>
              </div>
              <div className="flex items-center gap-2 text-sm text-claw-muted mt-0.5">
                <span className="font-mono">{skill.skillKey}</span>
                <button
                  className="text-claw-muted hover:text-claw-text transition-colors cursor-pointer"
                  onClick={() => copyToClipboard(skill.skillKey, 'key')}
                  title="复制 Skill Key"
                >
                  {copiedField === 'key' ? <Check size={13} /> : <Copy size={13} />}
                </button>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            {skill.reviewStatus === 'pending' && (
              <>
                <Button
                  variant="primary"
                  size="sm"
                  icon={<CheckCircle size={14} />}
                  loading={review.isPending}
                  onClick={() =>
                    review.mutate({ id: skill.id, action: 'approve', reviewedBy: 'admin' })
                  }
                >
                  审核通过
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  icon={<XCircle size={14} />}
                  loading={review.isPending}
                  onClick={() =>
                    review.mutate({ id: skill.id, action: 'reject', reviewedBy: 'admin' })
                  }
                >
                  拒绝
                </Button>
              </>
            )}
            {skill.reviewStatus === 'approved' && (
              <Button
                variant="primary"
                size="sm"
                icon={<Send size={14} />}
                onClick={() => setDeployOpen(true)}
              >
                部署到节点
              </Button>
            )}
            <Button
              variant="danger"
              size="sm"
              icon={<Trash2 size={14} />}
              loading={deleteSkill.isPending}
              onClick={handleDelete}
            >
              删除
            </Button>
          </div>
        </div>

        {/* Description */}
        {skill.description && (
          <p className="text-sm text-claw-muted mt-3">{skill.description}</p>
        )}

        {/* Meta grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4 pt-4 border-t border-claw-border text-sm">
          <div className="flex items-center gap-2">
            <Tag size={14} className="text-claw-muted shrink-0" />
            <div>
              <div className="text-claw-muted text-xs">来源</div>
              <div className="text-claw-text">{sourceLabels[skill.source] ?? skill.source}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {skill.scope === 'global' ? (
              <Globe size={14} className="text-claw-muted shrink-0" />
            ) : (
              <User size={14} className="text-claw-muted shrink-0" />
            )}
            <div>
              <div className="text-claw-muted text-xs">范围</div>
              <div className="text-claw-text">{skill.scope === 'global' ? '全局' : 'Agent'}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <FileText size={14} className="text-claw-muted shrink-0" />
            <div>
              <div className="text-claw-muted text-xs">版本</div>
              <div className="text-claw-text">{skill.version ?? '-'}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Clock size={14} className="text-claw-muted shrink-0" />
            <div>
              <div className="text-claw-muted text-xs">创建时间</div>
              <div className="text-claw-text">{new Date(skill.createdAt).toLocaleString()}</div>
            </div>
          </div>
        </div>

        {/* Dependencies */}
        {((skill.requiresBins && skill.requiresBins.length > 0) ||
          (skill.requiresEnv && skill.requiresEnv.length > 0)) && (
          <div className="flex gap-6 mt-3 pt-3 border-t border-claw-border text-sm">
            {skill.requiresBins && skill.requiresBins.length > 0 && (
              <div className="flex items-start gap-2">
                <Terminal size={14} className="text-claw-muted mt-0.5 shrink-0" />
                <div>
                  <div className="text-claw-muted text-xs mb-1">依赖命令</div>
                  <div className="flex gap-1.5 flex-wrap">
                    {skill.requiresBins.map((bin) => (
                      <span
                        key={bin}
                        className="px-2 py-0.5 bg-claw-input border border-claw-border rounded text-xs font-mono text-claw-text"
                      >
                        {bin}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}
            {skill.requiresEnv && skill.requiresEnv.length > 0 && (
              <div className="flex items-start gap-2">
                <Key size={14} className="text-claw-muted mt-0.5 shrink-0" />
                <div>
                  <div className="text-claw-muted text-xs mb-1">环境变量</div>
                  <div className="flex gap-1.5 flex-wrap">
                    {skill.requiresEnv.map((env) => (
                      <span
                        key={env}
                        className="px-2 py-0.5 bg-claw-input border border-claw-border rounded text-xs font-mono text-claw-text"
                      >
                        {env}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Review info */}
        {skill.reviewedBy && (
          <div className="flex gap-6 mt-3 pt-3 border-t border-claw-border text-sm text-claw-muted">
            <span>审核人: {skill.reviewedBy}</span>
            {skill.reviewedAt && (
              <span>审核时间: {new Date(skill.reviewedAt).toLocaleString()}</span>
            )}
          </div>
        )}
      </Card>

      {/* SKILL.md Content */}
      {skill.skillMdContent ? (
        <Card className="mb-5" padding="p-0">
          <div className="flex items-center justify-between px-5 py-3 border-b border-claw-border">
            <div className="flex items-center gap-2">
              <FileText size={14} className="text-claw-primary-light" />
              <span className="text-sm font-semibold text-claw-text">SKILL.md</span>
            </div>
            <button
              className="text-claw-muted hover:text-claw-text transition-colors cursor-pointer text-xs flex items-center gap-1"
              onClick={() => copyToClipboard(skill.skillMdContent!, 'md')}
            >
              {copiedField === 'md' ? <Check size={12} /> : <Copy size={12} />}
              {copiedField === 'md' ? '已复制' : '复制'}
            </button>
          </div>
          <pre className="p-5 text-sm text-claw-text overflow-auto max-h-[600px] font-mono whitespace-pre-wrap leading-relaxed">
            {skill.skillMdContent}
          </pre>
        </Card>
      ) : (
        <Card className="mb-5">
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <FileText size={40} className="text-claw-muted/40 mb-3" />
            <p className="text-sm text-claw-muted mb-1">该 Skill 暂无 SKILL.md 内容</p>
            <p className="text-xs text-claw-muted/70">
              请前往节点管理页面重新同步（发现结构），或通过 URL 重新导入此 Skill 以获取内容
            </p>
          </div>
        </Card>
      )}

      {/* Auxiliary Files */}
      {auxFileNames.length > 0 && (
        <Card padding="p-0">
          <div className="px-5 py-3 border-b border-claw-border">
            <div className="flex items-center gap-2">
              <FileText size={14} className="text-claw-accent" />
              <span className="text-sm font-semibold text-claw-text">
                附属文件 ({auxFileNames.length})
              </span>
            </div>
          </div>
          <div className="flex h-[400px]">
            {/* File list sidebar */}
            <div className="w-48 shrink-0 overflow-auto border-r border-claw-border bg-claw-input">
              {auxFileNames.map((name) => (
                <button
                  key={name}
                  onClick={() => setActiveFileTab(name)}
                  className={`w-full text-left px-3 py-2.5 text-sm flex items-center gap-2 border-b border-claw-border last:border-0 cursor-pointer transition-colors
                    ${activeAuxFile === name ? 'bg-claw-primary/15 text-claw-primary-light' : 'text-claw-text hover:bg-claw-card'}`}
                >
                  <FileText size={13} />
                  <span className="truncate">{name}</span>
                </button>
              ))}
            </div>
            {/* File content */}
            <div className="flex-1 flex flex-col overflow-hidden">
              {activeAuxFile ? (
                <>
                  <div className="flex items-center justify-between px-4 py-2 bg-claw-input border-b border-claw-border">
                    <span className="text-sm text-claw-text font-medium">{activeAuxFile}</span>
                    <button
                      className="text-claw-muted hover:text-claw-text transition-colors cursor-pointer text-xs flex items-center gap-1"
                      onClick={() => copyToClipboard(auxFiles[activeAuxFile], 'aux')}
                    >
                      {copiedField === 'aux' ? <Check size={12} /> : <Copy size={12} />}
                      {copiedField === 'aux' ? '已复制' : '复制'}
                    </button>
                  </div>
                  <pre className="flex-1 bg-claw-bg text-claw-text text-sm p-4 overflow-auto font-mono whitespace-pre-wrap">
                    {auxFiles[activeAuxFile]}
                  </pre>
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center text-claw-muted text-sm">
                  选择一个文件查看
                </div>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* Frontmatter */}
      {skill.frontmatter && Object.keys(skill.frontmatter).length > 0 && (
        <Card className="mt-5">
          <div className="flex items-center gap-2 mb-3">
            <Tag size={14} className="text-claw-primary-light" />
            <span className="text-sm font-semibold text-claw-text">Frontmatter</span>
          </div>
          <pre className="bg-claw-input border border-claw-border rounded-lg p-4 text-sm text-claw-text overflow-auto max-h-60 font-mono">
            {JSON.stringify(skill.frontmatter, null, 2)}
          </pre>
        </Card>
      )}

      {/* Deploy modal */}
      {deployOpen && (
        <DeploySkillModal
          open={deployOpen}
          onClose={() => setDeployOpen(false)}
          skillId={skill.id}
          skillName={skill.name}
        />
      )}
    </div>
  );
}
