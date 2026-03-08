import { useState, useEffect } from 'react';
import { X, Puzzle, ShieldCheck, GitBranch, Plus, Trash2 } from 'lucide-react';
import { Button } from '../ui/Button';
import type {
  WorkflowNodeDef,
  SkillNodeDef,
  ReviewNodeDef,
  ConditionNodeDef,
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

  const iconMap = { skill: Puzzle, review: ShieldCheck, condition: GitBranch };
  const labelMap = { skill: 'Skill 节点', review: '审核节点', condition: '条件节点' };
  const Icon = iconMap[draft.type];

  return (
    <div className="h-full flex flex-col bg-claw-sidebar border-l border-claw-border">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-claw-border">
        <div className="flex items-center gap-2">
          <Icon size={16} className="text-claw-primary-light" />
          <span className="text-sm font-semibold text-claw-text">{labelMap[draft.type]}</span>
        </div>
        <button onClick={onClose} className="text-claw-muted hover:text-claw-text transition-colors cursor-pointer">
          <X size={16} />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto px-5 py-4 space-y-4">
        <FieldGroup label="节点名称">
          <input
            className="w-full bg-claw-input border border-claw-border rounded-lg px-3 py-2 text-sm text-claw-text focus:border-claw-primary focus:outline-none"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </FieldGroup>

        <FieldGroup label="步骤 ID">
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

function FieldGroup({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-claw-muted mb-1.5 font-medium">{label}</label>
      {hint && <p className="text-[10px] text-claw-muted/70 mb-1.5">{hint}</p>}
      {children}
    </div>
  );
}

const inputClass =
  'w-full bg-claw-input border border-claw-border rounded-lg px-3 py-2 text-sm text-claw-text focus:border-claw-primary focus:outline-none';

function SkillFields({ draft, onChange }: { draft: SkillNodeDef; onChange: (d: SkillNodeDef) => void }) {
  return (
    <>
      <FieldGroup label="命令 (command)" hint="Lobster 步骤执行的命令，如 shell 命令或 Lobster 内置命令">
        <textarea
          className={`${inputClass} font-mono min-h-[60px]`}
          value={draft.command}
          onChange={(e) => onChange({ ...draft, command: e.target.value })}
          placeholder="e.g. exec --json --shell 'python summarize.py'"
        />
      </FieldGroup>

      <FieldGroup label="Skill 引用" hint="可选，关联 Skills 目录中的 Skill (用于自动填充命令)">
        <input
          className={`${inputClass} font-mono`}
          value={draft.skillRef ?? ''}
          onChange={(e) => onChange({ ...draft, skillRef: e.target.value || undefined })}
          placeholder="e.g. summarize-text"
        />
      </FieldGroup>

      <FieldGroup label="标准输入 (stdin)" hint="从前置步骤引用输出，格式: $stepId.stdout">
        <input
          className={`${inputClass} font-mono`}
          value={draft.stdin ?? ''}
          onChange={(e) => onChange({ ...draft, stdin: e.target.value || undefined })}
          placeholder="e.g. $collect.stdout"
        />
      </FieldGroup>

      <FieldGroup label="超时 (timeout)">
        <input
          className={inputClass}
          value={draft.timeout ?? ''}
          onChange={(e) => onChange({ ...draft, timeout: e.target.value || undefined })}
          placeholder="e.g. 5m, 1h"
        />
      </FieldGroup>

      <FieldGroup label="错误处理">
        <select
          className={inputClass}
          value={draft.onError ?? 'abort'}
          onChange={(e) => onChange({ ...draft, onError: e.target.value as SkillNodeDef['onError'] })}
        >
          <option value="abort">中止工作流</option>
          <option value="skip">跳过此步骤</option>
          <option value="fallback">执行 Fallback</option>
        </select>
      </FieldGroup>
    </>
  );
}

function ReviewFields({ draft, onChange }: { draft: ReviewNodeDef; onChange: (d: ReviewNodeDef) => void }) {
  return (
    <>
      <FieldGroup label="审批提示 (prompt)" hint="Lobster 暂停时显示给用户的提示文本">
        <textarea
          className={`${inputClass} min-h-[80px]`}
          value={draft.prompt ?? ''}
          onChange={(e) => onChange({ ...draft, prompt: e.target.value || undefined })}
          placeholder="请确认是否继续执行后续步骤..."
        />
      </FieldGroup>

      <div className="rounded-lg bg-claw-input/30 border border-claw-border/50 px-3 py-2.5">
        <p className="text-[11px] text-claw-muted leading-relaxed">
          审核由 Lobster 在远程节点上处理。当流水线执行到此步骤时，Lobster 会暂停并请求
          Agent 进行审批确认，Agent 可通过 lobster resume 命令批准或拒绝。
        </p>
      </div>
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
      <FieldGroup label="条件表达式" hint="Lobster 条件语法，引用前置步骤的输出字段，如 $stepId.field">
        <input
          className={`${inputClass} font-mono`}
          value={draft.expression}
          onChange={(e) => onChange({ ...draft, expression: e.target.value })}
          placeholder="e.g. $approve.approved"
        />
      </FieldGroup>

      <FieldGroup label="分支列表">
        <div className="space-y-2">
          {draft.branches.map((b, i) => (
            <div key={i} className="flex gap-2 items-center">
              <input
                className="flex-1 bg-claw-input border border-claw-border rounded-lg px-3 py-1.5 text-xs text-claw-text focus:border-claw-primary focus:outline-none font-mono"
                placeholder="条件 e.g. == true"
                value={b.condition}
                onChange={(e) => updateBranch(i, 'condition', e.target.value)}
              />
              <span className="text-claw-muted text-xs">&#8594;</span>
              <input
                className="w-28 bg-claw-input border border-claw-border rounded-lg px-3 py-1.5 text-xs text-claw-text focus:border-claw-primary focus:outline-none font-mono"
                placeholder="目标步骤ID"
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

      <FieldGroup label="默认分支">
        <input
          className={`${inputClass} font-mono`}
          value={draft.default ?? ''}
          onChange={(e) => onChange({ ...draft, default: e.target.value || undefined })}
          placeholder="默认目标步骤ID"
        />
      </FieldGroup>
    </>
  );
}
