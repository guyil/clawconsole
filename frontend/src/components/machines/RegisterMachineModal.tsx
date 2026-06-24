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
    gatewayPort: '',
    directConnect: false,
    gatewayToken: '',
    gatewayAesKey: '',
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
        gatewayPort: form.gatewayPort ? parseInt(form.gatewayPort) : undefined,
        directConnect: form.directConnect || undefined,
        gatewayToken: form.gatewayToken || undefined,
        gatewayAesKey: form.gatewayAesKey || undefined,
        tags: form.tags ? form.tags.split(',').map((t) => t.trim()) : undefined,
      },
      {
        onSuccess: () => {
          onClose();
          setForm({ name: '', tailscaleHostname: '', sshUser: 'claw', sshPort: '22', sshPassword: '', openclawHome: '~/.openclaw', gatewayPort: '', directConnect: false, gatewayToken: '', gatewayAesKey: '', tags: '' });
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
          <label className="block text-xs text-claw-muted mb-1">Gateway Token（直连模式必填）</label>
          <input
            className={inputClass}
            type="password"
            placeholder="openclaw gateway.auth.token，用于 admin-http-rpc 发现 agent"
            value={form.gatewayToken}
            onChange={(e) => setForm({ ...form, gatewayToken: e.target.value })}
          />
        </div>
        <div>
          <label className="block text-xs text-claw-muted mb-1">Gateway AES Key（Chat 功能必填）</label>
          <input
            className={inputClass}
            type="password"
            placeholder="X_AUTH_TOKEN_AES_KEY，用于 Chat 时签发 X-AUTH-TOKEN"
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
