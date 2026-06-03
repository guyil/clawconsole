import { StatusDot } from '../ui/StatusDot';
import { Badge } from '../ui/Badge';
import type { Agent } from '../../types/agent';

interface Props {
  agent: Agent;
  onClick?: () => void;
  selected?: boolean;
}

const statusLabels: Record<string, string> = {
  draft: '草稿',
  packaging: '打包中',
  syncing: '同步中',
  online: '在线',
  degraded: '降级',
  offline: '离线',
  archived: '已归档',
};

export function AgentCard({ agent, onClick, selected }: Props) {
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!onClick) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;

    event.preventDefault();
    onClick();
  };

  return (
    <div
      onClick={onClick}
      onKeyDown={handleKeyDown}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      className={`bg-claw-card rounded-xl border p-4 transition-all cursor-pointer hover:bg-claw-card-hover
        ${selected ? 'border-claw-primary' : 'border-claw-border'}`}
    >
      <div className="flex justify-between items-center mb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-claw-primary/30 to-claw-accent/30 flex items-center justify-center text-sm">
            🤖
          </div>
          <div>
            <div className="text-sm font-semibold text-claw-text">
              {agent.name || agent.agentId}
            </div>
            <div className="text-xs text-claw-muted">{agent.agentId}</div>
          </div>
        </div>
        <StatusDot status={agent.status === 'online' ? 'running' : agent.status === 'offline' ? 'offline' : 'paused'} />
      </div>

      <div className="flex gap-2 flex-wrap">
        <Badge variant={agent.status === 'online' ? 'success' : agent.status === 'offline' ? 'danger' : 'muted'}>
          {statusLabels[agent.status] ?? agent.status}
        </Badge>
        {agent.isDefault && <Badge variant="info">默认</Badge>}
        {(agent.discoveredSkills?.length ?? 0) > 0 && (
          <Badge variant="muted">Skills: {agent.discoveredSkills!.length}</Badge>
        )}
        {agent.workspacePath && (
          <span className="text-[11px] text-claw-muted">{agent.workspacePath}</span>
        )}
      </div>

      {agent.lastSyncedAt && (
        <div className="text-[11px] text-claw-muted mt-2">
          最后同步: {new Date(agent.lastSyncedAt).toLocaleString()}
        </div>
      )}
    </div>
  );
}
