import { Server, Bot, FolderOpen, FileText } from 'lucide-react';
import { Badge } from '../../ui/Badge';
import type { Machine } from '../../../types/machine';
import type { BotInfoData } from './BotInfoStep';

interface ConfirmStepProps {
  machine: Machine;
  botInfo: BotInfoData;
}

export function ConfirmStep({ machine, botInfo }: ConfirmStepProps) {
  const workspacePath = botInfo.isDefault ? 'workspace' : `workspace-${botInfo.agentId}`;

  return (
    <div className="space-y-5">
      <div className="bg-claw-bg rounded-lg border border-claw-border p-4 space-y-4">
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
      </div>

      {/* File changes */}
      <div>
        <div className="text-sm font-medium text-claw-text mb-2">将创建/修改以下文件</div>
        <div className="bg-claw-bg rounded-lg border border-claw-border p-3 space-y-1.5 font-mono text-xs">
          <div className="flex items-center gap-2 text-claw-warning">
            <FileText size={12} />
            <span>openclaw.json</span>
            <Badge variant="warning">修改</Badge>
            <span className="text-claw-muted">新增 agent 条目</span>
          </div>
          <div className="flex items-center gap-2 text-claw-success">
            <FolderOpen size={12} />
            <span>{workspacePath}/</span>
            <Badge variant="success">新建</Badge>
          </div>
          <div className="flex items-center gap-2 text-claw-success pl-4">
            <FileText size={12} />
            <span>SOUL.md</span>
            <Badge variant="success">新建</Badge>
            <span className="text-claw-muted">默认人设模板</span>
          </div>
          <div className="flex items-center gap-2 text-claw-success pl-4">
            <FileText size={12} />
            <span>README.md</span>
            <Badge variant="success">新建</Badge>
          </div>
        </div>
      </div>

      {/* Sync mode */}
      <div className="flex items-center gap-2 text-xs text-claw-muted">
        <span>同步模式：</span>
        <Badge variant="warning">Warm</Badge>
        <span>需重启 Gateway</span>
      </div>
    </div>
  );
}
