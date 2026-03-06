import { useState, useEffect } from 'react';
import { X, Puzzle, UserCheck, GitBranch, Plus, Trash2 } from 'lucide-react';
import { Button } from '../ui/Button';
import type {
  WorkflowNodeDef,
  SkillNodeDef,
  ReviewNodeDef,
  ConditionNodeDef,
  ReviewerRef,
  ConditionBranch,
} from '../../types/workflow';

interface NodeConfigPanelProps {
  node: WorkflowNodeDef;
  onSave: (node: WorkflowNodeDef) => void;
  onClose: () => void;
}

export function NodeConfigPanel({ node, onSave, onClose }: NodeConfigPanelProps) {
  const [draft, setDraft] = useState<WorkflowNodeDef>({ ...node });

  useEffect(() => {
    setDraft({ ...node });
  }, [node]);

  function handleSave() {
    onSave(draft);
  }

  const iconMap = { skill: Puzzle, review: UserCheck, condition: GitBranch };
  const Icon = iconMap[draft.type];

  return (
    <div className="h-full flex flex-col bg-claw-sidebar border-l border-claw-border">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-claw-border">
        <div className="flex items-center gap-2">
          <Icon size={16} className="text-claw-primary-light" />
          <span className="text-sm font-semibold text-claw-text">节点配置</span>
        </div>
        <button onClick={onClose} className="text-claw-muted hover:text-claw-text transition-colors cursor-pointer">
          <X size={16} />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto px-5 py-4 space-y-4">
        {/* Common: name */}
        <FieldGroup label="节点名称">
          <input
            className="w-full bg-claw-input border border-claw-border rounded-lg px-3 py-2 text-sm text-claw-text focus:border-claw-primary focus:outline-none"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </FieldGroup>

        <FieldGroup label="节点 ID">
          <input
            className="w-full bg-claw-input border border-claw-border rounded-lg px-3 py-2 text-sm text-claw-muted font-mono"
            value={draft.id}
            readOnly
          />
        </FieldGroup>

        {draft.type === 'skill' && <SkillFields draft={draft as SkillNodeDef} onChange={(d) => setDraft(d)} />}
        {draft.type === 'review' && <ReviewFields draft={draft as ReviewNodeDef} onChange={(d) => setDraft(d)} />}
        {draft.type === 'condition' && <ConditionFields draft={draft as ConditionNodeDef} onChange={(d) => setDraft(d)} />}
      </div>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-claw-border flex justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={onClose}>取消</Button>
        <Button size="sm" onClick={handleSave}>保存配置</Button>
      </div>
    </div>
  );
}

function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-claw-muted mb-1.5 font-medium">{label}</label>
      {children}
    </div>
  );
}

function SkillFields({ draft, onChange }: { draft: SkillNodeDef; onChange: (d: SkillNodeDef) => void }) {
  return (
    <>
      <FieldGroup label="Skill 引用 (skillRef)">
        <input
          className="w-full bg-claw-input border border-claw-border rounded-lg px-3 py-2 text-sm text-claw-text focus:border-claw-primary focus:outline-none font-mono"
          value={draft.skillRef}
          onChange={(e) => onChange({ ...draft, skillRef: e.target.value })}
          placeholder="e.g. summarize-text"
        />
      </FieldGroup>

      <FieldGroup label="输出变量名 (output)">
        <input
          className="w-full bg-claw-input border border-claw-border rounded-lg px-3 py-2 text-sm text-claw-text focus:border-claw-primary focus:outline-none font-mono"
          value={draft.output}
          onChange={(e) => onChange({ ...draft, output: e.target.value })}
          placeholder="e.g. summary_result"
        />
      </FieldGroup>

      <FieldGroup label="超时 (timeout)">
        <input
          className="w-full bg-claw-input border border-claw-border rounded-lg px-3 py-2 text-sm text-claw-text focus:border-claw-primary focus:outline-none"
          value={draft.timeout ?? ''}
          onChange={(e) => onChange({ ...draft, timeout: e.target.value || undefined })}
          placeholder="e.g. 5m, 1h"
        />
      </FieldGroup>

      <FieldGroup label="错误处理 (onError)">
        <select
          className="w-full bg-claw-input border border-claw-border rounded-lg px-3 py-2 text-sm text-claw-text focus:border-claw-primary focus:outline-none"
          value={draft.onError ?? 'abort'}
          onChange={(e) => onChange({ ...draft, onError: e.target.value as SkillNodeDef['onError'] })}
        >
          <option value="abort">中止工作流</option>
          <option value="skip">跳过此节点</option>
          <option value="fallback">执行 Fallback</option>
        </select>
      </FieldGroup>

      <FieldGroup label="输入参数 (input)">
        <KeyValueEditor
          entries={Object.entries(draft.input ?? {})}
          onChange={(entries) =>
            onChange({ ...draft, input: entries.length > 0 ? Object.fromEntries(entries) : undefined })
          }
        />
      </FieldGroup>
    </>
  );
}

function ReviewFields({ draft, onChange }: { draft: ReviewNodeDef; onChange: (d: ReviewNodeDef) => void }) {
  function updateReviewer(idx: number, field: keyof ReviewerRef, value: string) {
    const reviewers = [...draft.reviewers];
    reviewers[idx] = { ...reviewers[idx], [field]: value || undefined };
    onChange({ ...draft, reviewers });
  }

  function addReviewer() {
    onChange({ ...draft, reviewers: [...draft.reviewers, { role: '' }] });
  }

  function removeReviewer(idx: number) {
    const reviewers = draft.reviewers.filter((_, i) => i !== idx);
    if (reviewers.length > 0) onChange({ ...draft, reviewers });
  }

  return (
    <>
      <FieldGroup label="审核策略 (policy)">
        <select
          className="w-full bg-claw-input border border-claw-border rounded-lg px-3 py-2 text-sm text-claw-text focus:border-claw-primary focus:outline-none"
          value={draft.policy}
          onChange={(e) => onChange({ ...draft, policy: e.target.value as 'any' | 'all' })}
        >
          <option value="any">任一审核人通过</option>
          <option value="all">所有审核人通过</option>
        </select>
      </FieldGroup>

      <FieldGroup label="审核人列表">
        <div className="space-y-2">
          {draft.reviewers.map((r, i) => (
            <div key={i} className="flex gap-2 items-center">
              <input
                className="flex-1 bg-claw-input border border-claw-border rounded-lg px-3 py-1.5 text-sm text-claw-text focus:border-claw-primary focus:outline-none"
                placeholder="用户ID / 角色 / 群组"
                value={r.userId ?? r.role ?? r.group ?? ''}
                onChange={(e) => updateReviewer(i, r.userId ? 'userId' : r.group ? 'group' : 'role', e.target.value)}
              />
              <select
                className="bg-claw-input border border-claw-border rounded-lg px-2 py-1.5 text-xs text-claw-muted"
                value={r.userId ? 'userId' : r.group ? 'group' : 'role'}
                onChange={(e) => {
                  const val = r.userId ?? r.role ?? r.group ?? '';
                  const reviewers = [...draft.reviewers];
                  reviewers[i] = { [e.target.value]: val };
                  onChange({ ...draft, reviewers });
                }}
              >
                <option value="userId">用户</option>
                <option value="role">角色</option>
                <option value="group">群组</option>
              </select>
              <button onClick={() => removeReviewer(i)} className="text-claw-muted hover:text-claw-danger cursor-pointer">
                <Trash2 size={13} />
              </button>
            </div>
          ))}
          <button
            onClick={addReviewer}
            className="flex items-center gap-1 text-xs text-claw-primary-light hover:text-claw-text cursor-pointer"
          >
            <Plus size={12} /> 添加审核人
          </button>
        </div>
      </FieldGroup>

      <FieldGroup label="超时 (timeout)">
        <input
          className="w-full bg-claw-input border border-claw-border rounded-lg px-3 py-2 text-sm text-claw-text focus:border-claw-primary focus:outline-none"
          value={draft.timeout ?? ''}
          onChange={(e) => onChange({ ...draft, timeout: e.target.value || undefined })}
          placeholder="e.g. 24h"
        />
      </FieldGroup>
    </>
  );
}

function ConditionFields({ draft, onChange }: { draft: ConditionNodeDef; onChange: (d: ConditionNodeDef) => void }) {
  function updateBranch(idx: number, field: keyof ConditionBranch, value: string) {
    const branches = [...draft.branches];
    branches[idx] = { ...branches[idx], [field]: value };
    onChange({ ...draft, branches });
  }

  function addBranch() {
    onChange({ ...draft, branches: [...draft.branches, { condition: '', target: '' }] });
  }

  function removeBranch(idx: number) {
    const branches = draft.branches.filter((_, i) => i !== idx);
    if (branches.length > 0) onChange({ ...draft, branches });
  }

  return (
    <>
      <FieldGroup label="判断表达式 (expression)">
        <input
          className="w-full bg-claw-input border border-claw-border rounded-lg px-3 py-2 text-sm text-claw-text focus:border-claw-primary focus:outline-none font-mono"
          value={draft.expression}
          onChange={(e) => onChange({ ...draft, expression: e.target.value })}
          placeholder='e.g. {{ result.score }}'
        />
      </FieldGroup>

      <FieldGroup label="分支列表">
        <div className="space-y-2">
          {draft.branches.map((b, i) => (
            <div key={i} className="flex gap-2 items-center">
              <input
                className="flex-1 bg-claw-input border border-claw-border rounded-lg px-3 py-1.5 text-xs text-claw-text focus:border-claw-primary focus:outline-none font-mono"
                placeholder="条件 e.g. > 0.8"
                value={b.condition}
                onChange={(e) => updateBranch(i, 'condition', e.target.value)}
              />
              <span className="text-claw-muted text-xs">→</span>
              <input
                className="w-28 bg-claw-input border border-claw-border rounded-lg px-3 py-1.5 text-xs text-claw-text focus:border-claw-primary focus:outline-none font-mono"
                placeholder="目标节点ID"
                value={b.target}
                onChange={(e) => updateBranch(i, 'target', e.target.value)}
              />
              <button onClick={() => removeBranch(i)} className="text-claw-muted hover:text-claw-danger cursor-pointer">
                <Trash2 size={13} />
              </button>
            </div>
          ))}
          <button
            onClick={addBranch}
            className="flex items-center gap-1 text-xs text-claw-primary-light hover:text-claw-text cursor-pointer"
          >
            <Plus size={12} /> 添加分支
          </button>
        </div>
      </FieldGroup>

      <FieldGroup label="默认分支 (default)">
        <input
          className="w-full bg-claw-input border border-claw-border rounded-lg px-3 py-2 text-sm text-claw-text focus:border-claw-primary focus:outline-none font-mono"
          value={draft.default ?? ''}
          onChange={(e) => onChange({ ...draft, default: e.target.value || undefined })}
          placeholder="默认目标节点ID"
        />
      </FieldGroup>
    </>
  );
}

function KeyValueEditor({
  entries,
  onChange,
}: {
  entries: [string, string][];
  onChange: (entries: [string, string][]) => void;
}) {
  return (
    <div className="space-y-2">
      {entries.map(([key, value], i) => (
        <div key={i} className="flex gap-2 items-center">
          <input
            className="w-28 bg-claw-input border border-claw-border rounded-lg px-2 py-1.5 text-xs text-claw-text focus:border-claw-primary focus:outline-none font-mono"
            value={key}
            placeholder="参数名"
            onChange={(e) => {
              const next = [...entries] as [string, string][];
              next[i] = [e.target.value, value];
              onChange(next);
            }}
          />
          <span className="text-claw-muted text-xs">=</span>
          <input
            className="flex-1 bg-claw-input border border-claw-border rounded-lg px-2 py-1.5 text-xs text-claw-text focus:border-claw-primary focus:outline-none font-mono"
            value={value}
            placeholder="{{ var }}"
            onChange={(e) => {
              const next = [...entries] as [string, string][];
              next[i] = [key, e.target.value];
              onChange(next);
            }}
          />
          <button
            onClick={() => onChange(entries.filter((_, j) => j !== i))}
            className="text-claw-muted hover:text-claw-danger cursor-pointer"
          >
            <Trash2 size={13} />
          </button>
        </div>
      ))}
      <button
        onClick={() => onChange([...entries, ['', '']])}
        className="flex items-center gap-1 text-xs text-claw-primary-light hover:text-claw-text cursor-pointer"
      >
        <Plus size={12} /> 添加参数
      </button>
    </div>
  );
}
