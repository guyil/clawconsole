import { useState } from 'react';
import { Badge } from '../../ui/Badge';
import {
  MessageSquare,
  Plus,
  Trash2,
  AlertCircle,
  Info,
} from 'lucide-react';

export interface ChannelBinding {
  channelType: string;
  accountId: string;
  token: string;
  /** Slack signing secret, or Feishu App Secret */
  signingSecret?: string;
  /** Feishu Encrypt Key (optional, for event verification) */
  encryptKey?: string;
}

interface ChannelConfigStepProps {
  channels: ChannelBinding[];
  onChange: (channels: ChannelBinding[]) => void;
  /** Used as default accountId for new channels */
  defaultAccountId?: string;
}

const CHANNEL_OPTIONS = [
  {
    type: 'telegram',
    label: 'Telegram',
    icon: '🤖',
    tokenLabel: 'Bot Token',
    tokenPlaceholder: '123456:ABC-DEF...',
    helpText: 'From @BotFather: /newbot',
    requiresToken: true,
  },
  {
    type: 'discord',
    label: 'Discord',
    icon: '🎮',
    tokenLabel: 'Bot Token',
    tokenPlaceholder: 'MTIz...',
    helpText: 'Discord Developer Portal > Bot > Token',
    requiresToken: true,
  },
  {
    type: 'slack',
    label: 'Slack',
    icon: '💼',
    tokenLabel: 'Bot Token',
    tokenPlaceholder: 'xoxb-...',
    helpText: 'Slack API > OAuth & Permissions',
    requiresToken: true,
    hasSigningSecret: true,
  },
  {
    type: 'feishu',
    label: '飞书',
    icon: '🐦',
    tokenLabel: 'App ID',
    tokenPlaceholder: 'cli_xxxxxxxxxx',
    helpText: '飞书开放平台 > 企业自建应用 > 凭证与基础信息',
    requiresToken: true,
    hasSigningSecret: true,
    signingSecretLabel: 'App Secret',
    signingSecretPlaceholder: 'xxxxxxxxxxxxxxxx',
    hasEncryptKey: true,
    setupGuide: [
      '1. 在飞书开放平台创建企业自建应用，启用「机器人」能力',
      '2. 进入「事件与回调」，选择「使用长连接接收事件」(WebSocket 模式)',
      '3. 添加事件订阅：接收消息 (im.message.receive_v1) 等',
      '4. 在「权限管理」中开通所需权限（消息与群组等）',
      '5. 发布应用版本（应用不能处于草稿状态）',
    ],
  },
  {
    type: 'whatsapp',
    label: 'WhatsApp',
    icon: '💬',
    helpText: 'Requires QR pairing after deployment',
    requiresToken: false,
  },
  {
    type: 'signal',
    label: 'Signal',
    icon: '🔒',
    helpText: 'Requires device linking after deployment',
    requiresToken: false,
  },
] as const;

export function ChannelConfigStep({ channels, onChange, defaultAccountId }: ChannelConfigStepProps) {
  const [addingChannel, setAddingChannel] = useState<string | null>(null);

  const addedTypes = new Set(channels.map((c) => c.channelType));

  const addChannel = (type: string) => {
    const option = CHANNEL_OPTIONS.find((o) => o.type === type);
    if (!option) return;

    const newChannel: ChannelBinding = {
      channelType: type,
      accountId: defaultAccountId || 'default',
      token: '',
    };
    onChange([...channels, newChannel]);
    setAddingChannel(null);
  };

  const removeChannel = (index: number) => {
    onChange(channels.filter((_, i) => i !== index));
  };

  const updateChannel = (index: number, partial: Partial<ChannelBinding>) => {
    const updated = channels.map((ch, i) => (i === index ? { ...ch, ...partial } : ch));
    onChange(updated);
  };

  const availableChannels = CHANNEL_OPTIONS.filter((o) => !addedTypes.has(o.type));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-claw-text">消息渠道配置</h3>
          <p className="text-[11px] text-claw-muted mt-0.5">
            选择 Bot 使用的消息渠道（可选，部署后也可添加）
          </p>
        </div>
        {availableChannels.length > 0 && !addingChannel && (
          <button
            onClick={() => setAddingChannel('picking')}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-claw-primary-light bg-claw-primary/10 rounded-lg hover:bg-claw-primary/20 transition-colors cursor-pointer"
          >
            <Plus size={13} />
            添加渠道
          </button>
        )}
      </div>

      {/* Channel picker */}
      {addingChannel === 'picking' && (
        <div className="bg-claw-bg border border-claw-border rounded-lg p-3">
          <div className="text-xs text-claw-muted mb-2">选择渠道类型</div>
          <div className="grid grid-cols-2 gap-2">
            {availableChannels.map((option) => (
              <button
                key={option.type}
                onClick={() => addChannel(option.type)}
                className="flex items-center gap-2 px-3 py-2.5 text-sm text-claw-text bg-claw-card border border-claw-border rounded-lg hover:border-claw-primary/50 hover:bg-claw-primary/5 transition-all cursor-pointer"
              >
                <span className="text-base">{option.icon}</span>
                <span>{option.label}</span>
              </button>
            ))}
          </div>
          <button
            onClick={() => setAddingChannel(null)}
            className="mt-2 text-xs text-claw-muted hover:text-claw-text cursor-pointer"
          >
            取消
          </button>
        </div>
      )}

      {/* Configured channels */}
      {channels.length === 0 && addingChannel !== 'picking' && (
        <div className="text-center py-8 border border-dashed border-claw-border rounded-lg">
          <MessageSquare size={24} className="mx-auto text-claw-muted mb-2" />
          <p className="text-sm text-claw-muted">暂未配置渠道</p>
          <p className="text-[11px] text-claw-muted mt-1">
            可跳过此步骤，部署后再配置
          </p>
        </div>
      )}

      {channels.map((channel, index) => {
        const option = CHANNEL_OPTIONS.find((o) => o.type === channel.channelType);
        if (!option) return null;

        return (
          <div
            key={`${channel.channelType}-${index}`}
            className="bg-claw-bg border border-claw-border rounded-lg p-4 space-y-3"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-base">{option.icon}</span>
                <span className="text-sm font-semibold text-claw-text">{option.label}</span>
                {!option.requiresToken && (
                  <Badge variant="warning">部署后配置</Badge>
                )}
              </div>
              <button
                onClick={() => removeChannel(index)}
                className="p-1.5 text-claw-muted hover:text-claw-danger rounded-lg hover:bg-claw-danger/10 transition-colors cursor-pointer"
              >
                <Trash2 size={14} />
              </button>
            </div>

            {/* Account ID */}
            <div>
              <label className="block text-xs font-medium text-claw-text mb-1">
                Account ID
              </label>
              <input
                type="text"
                value={channel.accountId}
                onChange={(e) => updateChannel(index, { accountId: e.target.value })}
                placeholder="default"
                className="w-full px-3 py-1.5 text-sm bg-claw-card border border-claw-border rounded-lg text-claw-text placeholder:text-claw-muted focus:outline-none focus:border-claw-primary"
              />
            </div>

            {/* Token input (for channels that need it) */}
            {option.requiresToken && (
              <div>
                <label className="block text-xs font-medium text-claw-text mb-1">
                  {'tokenLabel' in option ? option.tokenLabel : 'Token'}
                </label>
                <input
                  type="password"
                  value={channel.token}
                  onChange={(e) => updateChannel(index, { token: e.target.value })}
                  placeholder={'tokenPlaceholder' in option ? option.tokenPlaceholder : ''}
                  className="w-full px-3 py-1.5 text-sm bg-claw-card border border-claw-border rounded-lg text-claw-text placeholder:text-claw-muted focus:outline-none focus:border-claw-primary font-mono"
                />
                {!channel.token && (
                  <p className="text-[11px] text-claw-warning flex items-center gap-1 mt-1">
                    <AlertCircle size={10} />
                    Token 必填
                  </p>
                )}
              </div>
            )}

            {/* Signing secret / App Secret */}
            {'hasSigningSecret' in option && option.hasSigningSecret && (
              <div>
                <label className="block text-xs font-medium text-claw-text mb-1">
                  {'signingSecretLabel' in option ? option.signingSecretLabel : 'Signing Secret'}
                </label>
                <input
                  type="password"
                  value={channel.signingSecret ?? ''}
                  onChange={(e) => updateChannel(index, { signingSecret: e.target.value })}
                  placeholder={'signingSecretPlaceholder' in option ? option.signingSecretPlaceholder : 'abc123...'}
                  className="w-full px-3 py-1.5 text-sm bg-claw-card border border-claw-border rounded-lg text-claw-text placeholder:text-claw-muted focus:outline-none focus:border-claw-primary font-mono"
                />
                {channel.channelType === 'feishu' && !channel.signingSecret && (
                  <p className="text-[11px] text-claw-warning flex items-center gap-1 mt-1">
                    <AlertCircle size={10} />
                    App Secret 必填
                  </p>
                )}
              </div>
            )}

            {/* Encrypt Key (Feishu only, optional) */}
            {'hasEncryptKey' in option && option.hasEncryptKey && (
              <div>
                <label className="block text-xs font-medium text-claw-text mb-1">
                  Encrypt Key <span className="text-claw-muted font-normal">(可选)</span>
                </label>
                <input
                  type="password"
                  value={channel.encryptKey ?? ''}
                  onChange={(e) => updateChannel(index, { encryptKey: e.target.value })}
                  placeholder="用于事件验证加密"
                  className="w-full px-3 py-1.5 text-sm bg-claw-card border border-claw-border rounded-lg text-claw-text placeholder:text-claw-muted focus:outline-none focus:border-claw-primary font-mono"
                />
              </div>
            )}

            {/* Setup guide (Feishu) */}
            {'setupGuide' in option && option.setupGuide && (
              <div className="bg-claw-card/50 border border-claw-border/50 rounded-lg p-3 space-y-1">
                <div className="text-[11px] font-medium text-claw-text mb-1.5">配置前请确认</div>
                {(option.setupGuide as readonly string[]).map((step) => (
                  <div key={step} className="text-[11px] text-claw-muted leading-relaxed">
                    {step}
                  </div>
                ))}
              </div>
            )}

            {/* Help text */}
            <div className="flex items-start gap-1.5 text-[11px] text-claw-muted">
              <Info size={11} className="mt-0.5 shrink-0" />
              <span>{option.helpText}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
