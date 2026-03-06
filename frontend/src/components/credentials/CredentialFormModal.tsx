import { useState, useEffect } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { useCreateCredential, useUpdateCredential } from '../../hooks/useCredentials';
import { useMachines } from '../../hooks/useMachines';
import type { Credential, CredentialType } from '../../types/credential';

interface Props {
  open: boolean;
  onClose: () => void;
  credential?: Credential | null;
}

const credentialTypes: { value: CredentialType; label: string }[] = [
  { value: 'api_key', label: 'API Key' },
  { value: 'oauth_token', label: 'OAuth Token' },
  { value: 'allow_from', label: 'Allow From' },
  { value: 'pairing', label: 'Pairing' },
  { value: 'webhook_secret', label: 'Webhook Secret' },
  { value: 'other', label: '其他' },
];

export function CredentialFormModal({ open, onClose, credential }: Props) {
  const isEdit = !!credential;
  const create = useCreateCredential();
  const update = useUpdateCredential();
  const { data: machinesData } = useMachines();

  const [form, setForm] = useState({
    machineId: '',
    name: '',
    credentialType: 'api_key' as CredentialType,
    provider: '',
    value: '',
    targetFilePath: '',
    description: '',
  });

  useEffect(() => {
    if (credential) {
      setForm({
        machineId: credential.machineId ?? '',
        name: credential.name,
        credentialType: credential.credentialType,
        provider: credential.provider ?? '',
        value: '',
        targetFilePath: credential.targetFilePath ?? '',
        description: credential.description ?? '',
      });
    } else {
      setForm({
        machineId: '',
        name: '',
        credentialType: 'api_key',
        provider: '',
        value: '',
        targetFilePath: '',
        description: '',
      });
    }
  }, [credential, open]);

  const machines = machinesData?.data ?? [];

  const handleSubmit = () => {
    if (isEdit && credential) {
      update.mutate(
        {
          id: credential.id,
          data: {
            name: form.name || undefined,
            value: form.value || undefined,
            targetFilePath: form.targetFilePath || undefined,
            description: form.description || undefined,
          },
        },
        { onSuccess: onClose },
      );
    } else {
      create.mutate(
        {
          machineId: form.machineId || undefined,
          name: form.name,
          credentialType: form.credentialType,
          provider: form.provider || undefined,
          value: form.value,
          targetFilePath: form.targetFilePath || undefined,
          description: form.description || undefined,
        },
        { onSuccess: onClose },
      );
    }
  };

  const inputClass =
    'w-full bg-claw-input border border-claw-border rounded-lg px-3 py-2 text-sm text-claw-text placeholder-claw-muted focus:outline-none focus:border-claw-primary';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? '编辑凭证' : '新建凭证'}
    >
      <div className="space-y-4">
        {!isEdit && (
          <div>
            <label className="block text-xs text-claw-muted mb-1">关联节点</label>
            <select
              className={inputClass}
              value={form.machineId}
              onChange={(e) => setForm({ ...form, machineId: e.target.value })}
            >
              <option value="">不关联（全局）</option>
              {machines.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.tailscaleHostname})
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="block text-xs text-claw-muted mb-1">名称 *</label>
          <input
            className={inputClass}
            placeholder="Anthropic API Key"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          {!isEdit && (
            <div>
              <label className="block text-xs text-claw-muted mb-1">类型</label>
              <select
                className={inputClass}
                value={form.credentialType}
                onChange={(e) =>
                  setForm({ ...form, credentialType: e.target.value as CredentialType })
                }
              >
                {credentialTypes.map((ct) => (
                  <option key={ct.value} value={ct.value}>
                    {ct.label}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="block text-xs text-claw-muted mb-1">Provider</label>
            <input
              className={inputClass}
              placeholder="anthropic"
              value={form.provider}
              onChange={(e) => setForm({ ...form, provider: e.target.value })}
            />
          </div>
        </div>
        <div>
          <label className="block text-xs text-claw-muted mb-1">
            {isEdit ? '新密钥值（留空不修改）' : '密钥值 *'}
          </label>
          <input
            className={inputClass}
            type="password"
            placeholder="sk-ant-..."
            value={form.value}
            onChange={(e) => setForm({ ...form, value: e.target.value })}
          />
        </div>
        <div>
          <label className="block text-xs text-claw-muted mb-1">目标文件路径</label>
          <input
            className={inputClass}
            placeholder="credentials/anthropic.json"
            value={form.targetFilePath}
            onChange={(e) => setForm({ ...form, targetFilePath: e.target.value })}
          />
        </div>
        <div>
          <label className="block text-xs text-claw-muted mb-1">描述</label>
          <input
            className={inputClass}
            placeholder="Production API key"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose}>取消</Button>
          <Button
            onClick={handleSubmit}
            loading={create.isPending || update.isPending}
            disabled={!form.name || (!isEdit && !form.value)}
          >
            {isEdit ? '保存' : '创建'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
