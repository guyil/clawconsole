import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { useProvisionAgent } from '../../hooks/useAgents';
import { AlertCircle, Info, Rocket } from 'lucide-react';
import type { AgentWithMachine } from '../../types/agent';

interface ConfigureFeishuModalProps {
  open: boolean;
  onClose: () => void;
  /**
   * The bot to attach Feishu to. Must be in a provisionable state
   * (draft / packaging / offline) — the backend will reject the
   * provision call otherwise.
   */
  agent: AgentWithMachine | null;
}

const FEISHU_GUIDE = [
  '1. 在飞书开放平台创建企业自建应用，启用「机器人」能力',
  '2. 进入「事件与回调」，选择「使用长连接接收事件」(WebSocket 模式)',
  '3. 添加事件订阅：接收消息 (im.message.receive_v1) 等',
  '4. 在「权限管理」中开通所需权限（消息与群组等）',
  '5. 发布应用版本（应用不能处于草稿状态）',
];

/**
 * Quick-action modal for attaching a Feishu (lark) channel to a Bot
 * that was just discovered (or is otherwise still in draft/offline).
 *
 * Reuses the `/agents/:id/provision` SSE endpoint with a single
 * `feishu` channel binding so the user doesn't have to walk through
 * the full create wizard.
 */
export function ConfigureFeishuModal({ open, onClose, agent }: ConfigureFeishuModalProps) {
  const navigate = useNavigate();
  const provisionAgent = useProvisionAgent();

  const [accountId, setAccountId] = useState('');
  const [appId, setAppId] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [encryptKey, setEncryptKey] = useState('');

  useEffect(() => {
    if (open && agent) {
      setAccountId(agent.agentId);
      setAppId('');
      setAppSecret('');
      setEncryptKey('');
    }
  }, [open, agent]);

  if (!agent) return null;

  const accountIdValid = /^[a-z0-9][a-z0-9_-]{0,49}$/.test(accountId);
  const canSubmit =
    accountIdValid &&
    appId.trim().length > 0 &&
    appSecret.trim().length > 0 &&
    !provisionAgent.isPending;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    try {
      await provisionAgent.mutateAsync({
        agentId: agent.id,
        channels: [
          {
            channelType: 'feishu',
            accountId: accountId.trim(),
            token: appId.trim(),
            signingSecret: appSecret.trim(),
            encryptKey: encryptKey.trim() || undefined,
          },
        ],
      });
      onClose();
      navigate(`/bots/${agent.id}`);
    } catch {
      // toast is shown by the mutation hook
    }
  };

  return (
    <Modal
      open={open}
      onClose={provisionAgent.isPending ? () => {} : onClose}
      title={`配置飞书 · ${agent.name || agent.agentId}`}
      width="max-w-xl"
    >
      <div className="space-y-4">
        <div className="bg-claw-input border border-claw-border rounded-lg p-3 text-xs text-claw-muted leading-relaxed">
          <div className="flex items-center gap-1.5 text-claw-text font-medium mb-1.5">
            <Info size={12} />
            将为该 Bot 绑定飞书渠道并部署到节点
          </div>
          <div>
            节点：<span className="text-claw-text">{agent.machineName}</span> ·
            Workspace：<span className="text-claw-text">{agent.workspacePath ?? '-'}</span>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-claw-text mb-1">
            Account ID
          </label>
          <input
            type="text"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            placeholder="default"
            disabled={provisionAgent.isPending}
            className="w-full px-3 py-1.5 text-sm bg-claw-card border border-claw-border rounded-lg text-claw-text placeholder:text-claw-muted focus:outline-none focus:border-claw-primary"
          />
          <p className="text-[11px] text-claw-muted mt-1">
            渠道账号标识，默认与 Bot ID 一致；同一节点上不同飞书 App 必须使用不同的 Account ID。
          </p>
          {!accountIdValid && (
            <p className="text-[11px] text-claw-warning flex items-center gap-1 mt-1">
              <AlertCircle size={10} />
              只能包含小写字母、数字、_ 和 -
            </p>
          )}
        </div>

        <div>
          <label className="block text-xs font-medium text-claw-text mb-1">
            App ID <span className="text-claw-danger">*</span>
          </label>
          <input
            type="password"
            value={appId}
            onChange={(e) => setAppId(e.target.value)}
            placeholder="cli_xxxxxxxxxx"
            disabled={provisionAgent.isPending}
            className="w-full px-3 py-1.5 text-sm bg-claw-card border border-claw-border rounded-lg text-claw-text placeholder:text-claw-muted focus:outline-none focus:border-claw-primary font-mono"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-claw-text mb-1">
            App Secret <span className="text-claw-danger">*</span>
          </label>
          <input
            type="password"
            value={appSecret}
            onChange={(e) => setAppSecret(e.target.value)}
            placeholder="xxxxxxxxxxxxxxxx"
            disabled={provisionAgent.isPending}
            className="w-full px-3 py-1.5 text-sm bg-claw-card border border-claw-border rounded-lg text-claw-text placeholder:text-claw-muted focus:outline-none focus:border-claw-primary font-mono"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-claw-text mb-1">
            Encrypt Key <span className="text-claw-muted font-normal">(可选)</span>
          </label>
          <input
            type="password"
            value={encryptKey}
            onChange={(e) => setEncryptKey(e.target.value)}
            placeholder="用于事件验证加密"
            disabled={provisionAgent.isPending}
            className="w-full px-3 py-1.5 text-sm bg-claw-card border border-claw-border rounded-lg text-claw-text placeholder:text-claw-muted focus:outline-none focus:border-claw-primary font-mono"
          />
        </div>

        <div className="bg-claw-card/40 border border-claw-border/60 rounded-lg p-3 space-y-1">
          <div className="text-[11px] font-medium text-claw-text mb-1.5">配置前请确认</div>
          {FEISHU_GUIDE.map((step) => (
            <div key={step} className="text-[11px] text-claw-muted leading-relaxed">
              {step}
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-claw-border">
        <Button
          variant="secondary"
          size="sm"
          onClick={onClose}
          disabled={provisionAgent.isPending}
        >
          取消
        </Button>
        <Button
          size="sm"
          icon={<Rocket size={14} />}
          loading={provisionAgent.isPending}
          disabled={!canSubmit}
          onClick={handleSubmit}
        >
          绑定飞书并部署
        </Button>
      </div>
    </Modal>
  );
}
