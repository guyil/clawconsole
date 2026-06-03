import { Server, Bot, FolderOpen, FileText, MessageSquare, Terminal, Copy } from 'lucide-react';
import { Badge } from '../../ui/Badge';
import { useAllAgents } from '../../../hooks/useAgents';
import type { Machine } from '../../../types/machine';
import type { BotInfoData } from './BotInfoStep';
import type { ChannelBinding } from './ChannelConfigStep';

const CHANNEL_LABELS: Record<string, { label: string; icon: string }> = {
  telegram: { label: 'Telegram', icon: '🤖' },
  discord: { label: 'Discord', icon: '🎮' },
  slack: { label: 'Slack', icon: '💼' },
  feishu: { label: '飞书', icon: '🐦' },
  whatsapp: { label: 'WhatsApp', icon: '💬' },
  signal: { label: 'Signal', icon: '🔒' },
};

interface ConfirmStepProps {
  machine: Machine;
  botInfo: BotInfoData;
  channels?: ChannelBinding[];
  copyFromAgentId?: string;
}

export function ConfirmStep({ machine, botInfo, channels = [], copyFromAgentId }: ConfirmStepProps) {
  const workspacePath = botInfo.isDefault ? 'workspace' : `workspace-${botInfo.agentId}`;
  const { data: allAgents } = useAllAgents();
  const sourceBot = copyFromAgentId
    ? (allAgents?.data ?? []).find((a) => a.id === copyFromAgentId)
    : null;

  return (
    <div className="space-y-5">
      <div className="bg-claw-bg rounded-lg border border-claw-border p-4 space-y-4">
        {/* Clone source */}
        {sourceBot && (
          <>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-claw-accent/10 flex items-center justify-center">
                <Copy size={16} className="text-claw-accent" />
              </div>
              <div>
                <div className="text-[11px] text-claw-muted">复制配置自</div>
                <div className="text-sm font-semibold text-claw-text">
                  {sourceBot.name || sourceBot.agentId}
                  <span className="text-claw-muted font-normal ml-2">@ {sourceBot.machineName}</span>
                </div>
              </div>
              <Badge variant="info">Clone</Badge>
            </div>
            <div className="border-t border-claw-border" />
          </>
        )}

        {/* Target node */}
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-claw-primary/10 flex items-center justify-center">
            <Server size={16} className="text-claw-primary-light" />
          </div>
          <div>
            <div className="text-[11px] text-claw-muted">目标节点</div>
            <div className="text-sm font-semibold text-claw-text">
              {machine.name}
              <span className="text-claw-muted font-normal ml-2">({machine.tailscaleHostname})</span>
            </div>
          </div>
        </div>

        <div className="border-t border-claw-border" />

        {/* Bot info */}
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-claw-accent/10 flex items-center justify-center">
            <Bot size={16} className="text-claw-accent" />
          </div>
          <div className="flex-1">
            <div className="text-[11px] text-claw-muted">Bot 信息</div>
            <div className="text-sm text-claw-text">
              <span className="font-semibold">{botInfo.agentId}</span>
              {botInfo.name && (
                <span className="text-claw-muted ml-2">({botInfo.name})</span>
              )}
            </div>
            {botInfo.description && (
              <div className="text-[11px] text-claw-muted mt-0.5">{botInfo.description}</div>
            )}
          </div>
          {botInfo.isDefault && <Badge variant="info">默认</Badge>}
        </div>

        {/* Channel bindings */}
        {channels.length > 0 && (
          <>
            <div className="border-t border-claw-border" />
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-green-500/10 flex items-center justify-center">
                <MessageSquare size={16} className="text-green-400" />
              </div>
              <div className="flex-1">
                <div className="text-[11px] text-claw-muted">消息渠道</div>
                <div className="flex flex-wrap gap-2 mt-1">
                  {channels.map((ch, i) => {
                    const info = CHANNEL_LABELS[ch.channelType];
                    const needsPostDeploy = ch.channelType === 'whatsapp' || ch.channelType === 'signal';
                    return (
                      <div
                        key={`${ch.channelType}-${i}`}
                        className="flex items-center gap-1.5 px-2 py-1 bg-claw-card border border-claw-border rounded-md text-xs"
                      >
                        <span>{info?.icon ?? '📡'}</span>
                        <span className="text-claw-text font-medium">
                          {info?.label ?? ch.channelType}
                        </span>
                        <span className="text-claw-muted">:{ch.accountId}</span>
                        {needsPostDeploy && (
                          <Badge variant="warning">部署后配置</Badge>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Deployment pipeline steps */}
      <div>
        <div className="text-sm font-medium text-claw-text mb-2">部署执行步骤</div>
        <div className="bg-claw-bg rounded-lg border border-claw-border p-3 space-y-2 font-mono text-xs">
          <DeployStep
            step={1}
            label="创建 Agent"
            command={`openclaw agents add ${botInfo.agentId} --non-interactive --workspace ${workspacePath}`}
          />
          {channels.map((ch, i) => (
            <div key={`steps-${ch.channelType}-${i}`} className="space-y-2">
              <DeployStep
                step={2 + i * 2}
                label={`配置渠道 ${CHANNEL_LABELS[ch.channelType]?.label ?? ch.channelType}`}
                command={`jq '.channels.${ch.channelType}.accounts.${ch.accountId} = {...}' openclaw.json`}
              />
              <DeployStep
                step={3 + i * 2}
                label={`绑定渠道路由`}
                command={`openclaw agents bind --agent ${botInfo.agentId} --bind ${ch.channelType}:${ch.accountId}`}
              />
            </div>
          ))}
          <DeployStep
            step={channels.length > 0 ? 2 + channels.length * 2 : 2}
            label="重启 Gateway"
            command="openclaw gateway restart"
          />
          {sourceBot && (
            <DeployStep
              step={channels.length > 0 ? 3 + channels.length * 2 : 3}
              label="复制配置文件"
              command={`cp ${sourceBot.agentId}/config -> ${botInfo.agentId}/config (SOUL.md, IDENTITY.md, ...)`}
            />
          )}
        </div>
      </div>

      {/* File changes */}
      <div>
        <div className="text-sm font-medium text-claw-text mb-2">将创建/修改以下文件</div>
        <div className="bg-claw-bg rounded-lg border border-claw-border p-3 space-y-1.5 font-mono text-xs">
          <div className="flex items-center gap-2 text-claw-warning">
            <FileText size={12} />
            <span>openclaw.json</span>
            <Badge variant="warning">修改</Badge>
            <span className="text-claw-muted">新增 agent 条目 + 渠道账户 + 路由绑定</span>
          </div>
          <div className="flex items-center gap-2 text-claw-success">
            <FolderOpen size={12} />
            <span>{workspacePath}/</span>
            <Badge variant="success">新建</Badge>
          </div>
          <div className="flex items-center gap-2 text-claw-success pl-4">
            <FileText size={12} />
            <span>SOUL.md</span>
            <Badge variant={sourceBot ? 'info' : 'success'}>{sourceBot ? '复制' : '新建'}</Badge>
            <span className="text-claw-muted">{sourceBot ? `来自 ${sourceBot.agentId}` : '默认人设模板'}</span>
          </div>
          <div className="flex items-center gap-2 text-claw-success pl-4">
            <FileText size={12} />
            <span>IDENTITY.md</span>
            <Badge variant={sourceBot ? 'info' : 'success'}>{sourceBot ? '复制' : '新建'}</Badge>
          </div>
        </div>
      </div>
    </div>
  );
}

function DeployStep({ step, label, command }: { step: number; label: string; command: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-claw-primary/20 text-claw-primary-light text-[10px] font-bold flex-shrink-0 mt-0.5">
        {step}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <Terminal size={11} className="text-claw-muted flex-shrink-0" />
          <span className="text-claw-text">{label}</span>
        </div>
        <div className="mt-0.5 text-[10px] text-claw-muted break-all leading-relaxed">
          $ {command}
        </div>
      </div>
    </div>
  );
}
