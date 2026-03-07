import { useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import type { TriggerType } from '../../types/workflow';

const triggerTypeOptions: { value: TriggerType; label: string; desc: string }[] = [
  { value: 'message', label: '消息触发', desc: '当收到匹配的消息时触发' },
  { value: 'schedule', label: '定时触发', desc: '按 Cron 表达式定时执行' },
  { value: 'webhook', label: 'Webhook', desc: '通过 HTTP Webhook 触发' },
  { value: 'manual', label: '手动触发', desc: '由用户手动启动' },
];

interface CreateWorkflowModalProps {
  open: boolean;
  onClose: () => void;
  onCreate: (data: {
    name: string;
    description: string;
    machineId: string;
    triggerType: TriggerType;
    channel?: string;
    pattern?: string;
    cron?: string;
  }) => void;
  machines: { id: string; name: string }[];
  loading?: boolean;
}

export function CreateWorkflowModal({ open, onClose, onCreate, machines, loading }: CreateWorkflowModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [machineId, setMachineId] = useState(machines[0]?.id ?? '');
  const [triggerType, setTriggerType] = useState<TriggerType>('manual');
  const [channel, setChannel] = useState('');
  const [pattern, setPattern] = useState('');
  const [cron, setCron] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !machineId) return;
    onCreate({
      name: name.trim(),
      description: description.trim(),
      machineId,
      triggerType,
      channel: channel || undefined,
      pattern: pattern || undefined,
      cron: cron || undefined,
    });
  }

  return (
    <Modal open={open} onClose={onClose} title="创建工作流" width="max-w-md">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs text-claw-muted mb-1.5 font-medium">工作流名称 *</label>
          <input
            className="w-full bg-claw-input border border-claw-border rounded-lg px-3 py-2 text-sm text-claw-text focus:border-claw-primary focus:outline-none"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. 客户咨询自动回复"
            autoFocus
          />
        </div>

        <div>
          <label className="block text-xs text-claw-muted mb-1.5 font-medium">描述</label>
          <textarea
            className="w-full bg-claw-input border border-claw-border rounded-lg px-3 py-2 text-sm text-claw-text focus:border-claw-primary focus:outline-none resize-none"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="工作流的用途和说明..."
          />
        </div>

        <div>
          <label className="block text-xs text-claw-muted mb-1.5 font-medium">目标节点 *</label>
          <select
            className="w-full bg-claw-input border border-claw-border rounded-lg px-3 py-2 text-sm text-claw-text focus:border-claw-primary focus:outline-none"
            value={machineId}
            onChange={(e) => setMachineId(e.target.value)}
          >
            {machines.length === 0 && <option value="">暂无可用节点</option>}
            {machines.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs text-claw-muted mb-1.5 font-medium">触发方式 *</label>
          <div className="grid grid-cols-2 gap-2">
            {triggerTypeOptions.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`text-left px-3 py-2.5 rounded-xl border transition-all cursor-pointer ${
                  triggerType === opt.value
                    ? 'border-claw-primary bg-claw-primary/10 text-claw-text'
                    : 'border-claw-border bg-claw-card text-claw-muted hover:border-claw-primary/30'
                }`}
                onClick={() => setTriggerType(opt.value)}
              >
                <div className="text-sm font-medium">{opt.label}</div>
                <div className="text-[10px] mt-0.5 opacity-70">{opt.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {triggerType === 'message' && (
          <>
            <div>
              <label className="block text-xs text-claw-muted mb-1.5 font-medium">频道 (channel)</label>
              <input
                className="w-full bg-claw-input border border-claw-border rounded-lg px-3 py-2 text-sm text-claw-text focus:border-claw-primary focus:outline-none"
                value={channel}
                onChange={(e) => setChannel(e.target.value)}
                placeholder="e.g. feishu, wechat"
              />
            </div>
            <div>
              <label className="block text-xs text-claw-muted mb-1.5 font-medium">匹配模式 (pattern)</label>
              <input
                className="w-full bg-claw-input border border-claw-border rounded-lg px-3 py-2 text-sm text-claw-text focus:border-claw-primary focus:outline-none font-mono"
                value={pattern}
                onChange={(e) => setPattern(e.target.value)}
                placeholder="e.g. /help.*/"
              />
            </div>
          </>
        )}

        {triggerType === 'schedule' && (
          <div>
            <label className="block text-xs text-claw-muted mb-1.5 font-medium">Cron 表达式</label>
            <input
              className="w-full bg-claw-input border border-claw-border rounded-lg px-3 py-2 text-sm text-claw-text focus:border-claw-primary focus:outline-none font-mono"
              value={cron}
              onChange={(e) => setCron(e.target.value)}
              placeholder="e.g. 0 9 * * * (每天 9 点)"
            />
          </div>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" type="button" onClick={onClose}>取消</Button>
          <Button type="submit" loading={loading} disabled={!name.trim() || !machineId}>
            创建工作流
          </Button>
        </div>
      </form>
    </Modal>
  );
}
