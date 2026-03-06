import { useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { useCreateSkill } from '../../hooks/useSkills';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function AddSkillModal({ open, onClose }: Props) {
  const create = useCreateSkill();
  const [form, setForm] = useState({
    skillKey: '',
    name: '',
    description: '',
    scope: 'global' as 'global' | 'agent',
    source: 'custom' as 'custom' | 'clawhub' | 'bundled',
    version: '1.0.0',
    skillMdContent: '',
    requiresBins: '',
    requiresEnv: '',
  });

  const handleSubmit = () => {
    create.mutate(
      {
        skillKey: form.skillKey,
        name: form.name,
        description: form.description || undefined,
        scope: form.scope,
        source: form.source,
        version: form.version || undefined,
        skillMdContent: form.skillMdContent || undefined,
        requiresBins: form.requiresBins ? form.requiresBins.split(',').map((s) => s.trim()) : undefined,
        requiresEnv: form.requiresEnv ? form.requiresEnv.split(',').map((s) => s.trim()) : undefined,
      },
      {
        onSuccess: () => {
          onClose();
          setForm({ skillKey: '', name: '', description: '', scope: 'global' as 'global' | 'agent', source: 'custom' as 'custom' | 'clawhub' | 'bundled', version: '1.0.0', skillMdContent: '', requiresBins: '', requiresEnv: '' });
        },
      },
    );
  };

  const inputClass =
    'w-full bg-claw-input border border-claw-border rounded-lg px-3 py-2 text-sm text-claw-text placeholder-claw-muted focus:outline-none focus:border-claw-primary';

  return (
    <Modal open={open} onClose={onClose} title="添加 Skill" width="max-w-xl">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-claw-muted mb-1">Skill Key *</label>
            <input
              className={inputClass}
              placeholder="feishu-webhook"
              value={form.skillKey}
              onChange={(e) => setForm({ ...form, skillKey: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-xs text-claw-muted mb-1">名称 *</label>
            <input
              className={inputClass}
              placeholder="Feishu Webhook"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
        </div>
        <div>
          <label className="block text-xs text-claw-muted mb-1">描述</label>
          <input
            className={inputClass}
            placeholder="Skill 描述"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-xs text-claw-muted mb-1">范围</label>
            <select
              className={inputClass}
              value={form.scope}
              onChange={(e) => setForm({ ...form, scope: e.target.value as typeof form.scope })}
            >
              <option value="global">全局</option>
              <option value="agent">Agent</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-claw-muted mb-1">来源</label>
            <select
              className={inputClass}
              value={form.source}
              onChange={(e) => setForm({ ...form, source: e.target.value as typeof form.source })}
            >
              <option value="custom">自定义</option>
              <option value="clawhub">ClawHub</option>
              <option value="bundled">内置</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-claw-muted mb-1">版本</label>
            <input
              className={inputClass}
              value={form.version}
              onChange={(e) => setForm({ ...form, version: e.target.value })}
            />
          </div>
        </div>
        <div>
          <label className="block text-xs text-claw-muted mb-1">SKILL.md 内容</label>
          <textarea
            className={`${inputClass} h-32 resize-none font-mono`}
            placeholder="---\nname: my-skill\n---\n# Content"
            value={form.skillMdContent}
            onChange={(e) => setForm({ ...form, skillMdContent: e.target.value })}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-claw-muted mb-1">依赖命令（逗号分隔）</label>
            <input
              className={inputClass}
              placeholder="curl, jq"
              value={form.requiresBins}
              onChange={(e) => setForm({ ...form, requiresBins: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-xs text-claw-muted mb-1">环境变量（逗号分隔）</label>
            <input
              className={inputClass}
              placeholder="API_KEY, TOKEN"
              value={form.requiresEnv}
              onChange={(e) => setForm({ ...form, requiresEnv: e.target.value })}
            />
          </div>
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose}>取消</Button>
          <Button
            onClick={handleSubmit}
            loading={create.isPending}
            disabled={!form.skillKey || !form.name}
          >
            添加
          </Button>
        </div>
      </div>
    </Modal>
  );
}
