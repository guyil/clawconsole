import { useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { useCreateMachine } from '../../hooks/useMachines';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function RegisterMachineModal({ open, onClose }: Props) {
  const createMachine = useCreateMachine();
  const [form, setForm] = useState({
    name: '',
    tailscaleHostname: '',
    sshUser: 'claw',
    sshPort: '22',
    sshPassword: '',
    openclawHome: '~/.openclaw',
    tags: '',
  });

  const handleSubmit = () => {
    createMachine.mutate(
      {
        name: form.name,
        tailscaleHostname: form.tailscaleHostname,
        sshUser: form.sshUser || undefined,
        sshPort: form.sshPort ? parseInt(form.sshPort) : undefined,
        sshPassword: form.sshPassword || undefined,
        openclawHome: form.openclawHome || undefined,
        tags: form.tags ? form.tags.split(',').map((t) => t.trim()) : undefined,
      },
      {
        onSuccess: () => {
          onClose();
          setForm({ name: '', tailscaleHostname: '', sshUser: 'claw', sshPort: '22', sshPassword: '', openclawHome: '~/.openclaw', tags: '' });
        },
      },
    );
  };

  const inputClass =
    'w-full bg-claw-input border border-claw-border rounded-lg px-3 py-2 text-sm text-claw-text placeholder-claw-muted focus:outline-none focus:border-claw-primary';

  return (
    <Modal open={open} onClose={onClose} title="注册新节点">
      <div className="space-y-4">
        <div>
          <label className="block text-xs text-claw-muted mb-1">节点名称 *</label>
          <input
            className={inputClass}
            placeholder="例如: CS Bot Server"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </div>
        <div>
          <label className="block text-xs text-claw-muted mb-1">Tailscale 主机名 *</label>
          <input
            className={inputClass}
            placeholder="例如: cs-bot.tailnet"
            value={form.tailscaleHostname}
            onChange={(e) => setForm({ ...form, tailscaleHostname: e.target.value })}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-claw-muted mb-1">SSH 用户</label>
            <input
              className={inputClass}
              value={form.sshUser}
              onChange={(e) => setForm({ ...form, sshUser: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-xs text-claw-muted mb-1">SSH 端口</label>
            <input
              className={inputClass}
              type="number"
              value={form.sshPort}
              onChange={(e) => setForm({ ...form, sshPort: e.target.value })}
            />
          </div>
        </div>
        <div>
          <label className="block text-xs text-claw-muted mb-1">SSH 密码（可选）</label>
          <input
            className={inputClass}
            type="password"
            placeholder="留空则使用 SSH Key 认证"
            value={form.sshPassword}
            onChange={(e) => setForm({ ...form, sshPassword: e.target.value })}
          />
        </div>
        <div>
          <label className="block text-xs text-claw-muted mb-1">OpenClaw Home</label>
          <input
            className={inputClass}
            value={form.openclawHome}
            onChange={(e) => setForm({ ...form, openclawHome: e.target.value })}
          />
        </div>
        <div>
          <label className="block text-xs text-claw-muted mb-1">标签（逗号分隔）</label>
          <input
            className={inputClass}
            placeholder="production, asia"
            value={form.tags}
            onChange={(e) => setForm({ ...form, tags: e.target.value })}
          />
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button
            onClick={handleSubmit}
            loading={createMachine.isPending}
            disabled={!form.name || !form.tailscaleHostname}
          >
            注册
          </Button>
        </div>
      </div>
    </Modal>
  );
}
