import { useState, useEffect } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { useUpdateMachine } from '../../hooks/useMachines';
import type { Machine } from '../../types/machine';

interface Props {
  open: boolean;
  onClose: () => void;
  machine: Machine;
}

export function EditMachineModal({ open, onClose, machine }: Props) {
  const updateMachine = useUpdateMachine();
  const [form, setForm] = useState({
    name: '',
    sshUser: '',
    sshPort: '',
    sshPassword: '',
    openclawHome: '',
    gatewayPort: '',
    directConnect: false,
    gatewayToken: '',
    gatewayAesKey: '',
    tags: '',
  });

  useEffect(() => {
    if (machine && open) {
      setForm({
        name: machine.name,
        sshUser: machine.sshUser,
        sshPort: String(machine.sshPort),
        sshPassword: '',
        openclawHome: machine.openclawHome,
        gatewayPort: machine.gatewayPort != null ? String(machine.gatewayPort) : '',
        directConnect: machine.directConnect ?? false,
        gatewayToken: '',
        gatewayAesKey: '',
        tags: machine.tags?.join(', ') ?? '',
      });
    }
  }, [machine, open]);

  const handleSubmit = () => {
    updateMachine.mutate(
      {
        id: machine.id,
        data: {
          name: form.name || undefined,
          sshUser: form.sshUser || undefined,
          sshPort: form.sshPort ? parseInt(form.sshPort) : undefined,
          sshPassword: form.sshPassword || undefined,
          openclawHome: form.openclawHome || undefined,
          gatewayPort: form.gatewayPort ? parseInt(form.gatewayPort) : null,
          directConnect: form.directConnect,
          gatewayToken: form.gatewayToken || undefined,
          gatewayAesKey: form.gatewayAesKey || undefined,
          tags: form.tags ? form.tags.split(',').map((t) => t.trim()) : undefined,
        },
      },
      { onSuccess: onClose },
    );
  };

  const handleClearPassword = () => {
    updateMachine.mutate(
      {
        id: machine.id,
        data: { sshPassword: null },
      },
      { onSuccess: onClose },
    );
  };

  const inputClass =
    'w-full bg-claw-input border border-claw-border rounded-lg px-3 py-2 text-sm text-claw-text placeholder-claw-muted focus:outline-none focus:border-claw-primary';

  return (
    <Modal open={open} onClose={onClose} title="编辑节点">
      <div className="space-y-4">
        <div>
          <label className="block text-xs text-claw-muted mb-1">节点名称</label>
          <input
            className={inputClass}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
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
          <label className="block text-xs text-claw-muted mb-1">SSH 密码</label>
          <div className="flex gap-2">
            <input
              className={inputClass}
              type="password"
              placeholder={machine.sshPassword ? '已设置（留空不修改）' : '留空则使用 SSH Key 认证'}
              value={form.sshPassword}
              onChange={(e) => setForm({ ...form, sshPassword: e.target.value })}
            />
            {machine.sshPassword && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClearPassword}
                className="text-claw-danger hover:bg-claw-danger/10 whitespace-nowrap"
              >
                清除
              </Button>
            )}
          </div>
          <p className="text-[11px] text-claw-muted mt-1">
            {machine.sshPassword ? '当前使用密码认证' : '当前使用 SSH Key 认证'}
          </p>
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
          <label className="block text-xs text-claw-muted mb-1">Gateway 端口（可选）</label>
          <input
            className={inputClass}
            type="number"
            placeholder="留空使用默认 18789"
            value={form.gatewayPort}
            onChange={(e) => setForm({ ...form, gatewayPort: e.target.value })}
          />
        </div>
        <div>
          <label className="flex items-center gap-2 text-sm text-claw-text cursor-pointer">
            <input
              type="checkbox"
              checked={form.directConnect}
              onChange={(e) => setForm({ ...form, directConnect: e.target.checked })}
            />
            直连模式（公网 IP，跳过 Tailscale）
          </label>
          <p className="text-[11px] text-claw-muted mt-1">
            勾选后将主机名按原始 IP 直连 SSH/Gateway，不做 Tailscale 探活。
          </p>
        </div>
        <div>
          <label className="block text-xs text-claw-muted mb-1">Gateway Token（留空则不修改）</label>
          <input
            className={inputClass}
            type="password"
            placeholder="直连模式用于 admin-http-rpc 发现 agent"
            value={form.gatewayToken}
            onChange={(e) => setForm({ ...form, gatewayToken: e.target.value })}
          />
        </div>
        <div>
          <label className="block text-xs text-claw-muted mb-1">Gateway AES Key（留空则不修改）</label>
          <input
            className={inputClass}
            type="password"
            placeholder="Chat 功能用于签发 X-AUTH-TOKEN"
            value={form.gatewayAesKey}
            onChange={(e) => setForm({ ...form, gatewayAesKey: e.target.value })}
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
            loading={updateMachine.isPending}
          >
            保存
          </Button>
        </div>
      </div>
    </Modal>
  );
}
