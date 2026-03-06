import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAllAgents } from '../hooks/useAgents';
import { StatusDot } from '../components/ui/StatusDot';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { PageSpinner } from '../components/ui/Spinner';
import { CreateBotWizard } from '../components/bots/CreateBotWizard';
import { Bot, Server, Puzzle, Plus } from 'lucide-react';
import type { AgentWithMachine } from '../types/agent';

const statusLabels: Record<string, string> = {
  draft: '草稿',
  packaging: '打包中',
  syncing: '同步中',
  online: '在线',
  degraded: '降级',
  offline: '离线',
  archived: '已归档',
};

function BotCard({ agent, onClick }: { agent: AgentWithMachine; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      className="bg-claw-card rounded-xl border border-claw-border p-4 transition-all cursor-pointer hover:bg-claw-card-hover hover:border-claw-primary/40"
    >
      <div className="flex justify-between items-center mb-3">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-claw-primary/30 to-claw-accent/30 flex items-center justify-center">
            <Bot size={18} className="text-claw-primary-light" />
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

      <div className="flex gap-2 flex-wrap items-center">
        <Badge variant={agent.status === 'online' ? 'success' : agent.status === 'offline' ? 'danger' : 'muted'}>
          {statusLabels[agent.status] ?? agent.status}
        </Badge>
        {agent.isDefault && <Badge variant="info">默认</Badge>}
      </div>

      <div className="flex items-center gap-3 mt-3 text-[11px] text-claw-muted">
        <span className="flex items-center gap-1">
          <Server size={11} />
          {agent.machineName}
        </span>
        {((agent.discoveredSkills?.length ?? 0) + (agent.globalSkills?.length ?? 0)) > 0 && (
          <span className="flex items-center gap-1">
            <Puzzle size={11} />
            Skills: {(agent.discoveredSkills?.length ?? 0) + (agent.globalSkills?.length ?? 0)}
          </span>
        )}
      </div>
    </div>
  );
}

export function BotsPage() {
  const { data, isLoading } = useAllAgents();
  const navigate = useNavigate();
  const [wizardOpen, setWizardOpen] = useState(false);

  if (isLoading) return <PageSpinner />;

  const agents = data?.data ?? [];

  // Group by machine
  const grouped = agents.reduce<Record<string, { machineName: string; agents: AgentWithMachine[] }>>((acc, agent) => {
    if (!acc[agent.machineId]) {
      acc[agent.machineId] = { machineName: agent.machineName, agents: [] };
    }
    acc[agent.machineId].agents.push(agent);
    return acc;
  }, {});

  return (
    <div>
      <div className="flex justify-between items-center mb-5">
        <div className="text-[13px] text-claw-muted">
          共 {agents.length} 个 Bot
        </div>
        <Button size="sm" icon={<Plus size={14} />} onClick={() => setWizardOpen(true)}>
          新建 Bot
        </Button>
      </div>

      <CreateBotWizard open={wizardOpen} onClose={() => setWizardOpen(false)} />

      {agents.length === 0 ? (
        <EmptyState
          icon={<Bot size={48} />}
          title="暂无 Bot"
          description="请先在节点管理中注册节点并扫描 Agent"
          action={
            <Button size="sm" icon={<Plus size={14} />} onClick={() => setWizardOpen(true)}>
              新建 Bot
            </Button>
          }
        />
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([machineId, group]) => (
            <div key={machineId}>
              <div className="flex items-center gap-2 mb-3">
                <Server size={14} className="text-claw-muted" />
                <h3 className="text-sm font-semibold text-claw-text">{group.machineName}</h3>
                <span className="text-xs text-claw-muted">({group.agents.length})</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {group.agents.map((agent) => (
                  <BotCard
                    key={agent.id}
                    agent={agent}
                    onClick={() => navigate(`/bots/${agent.id}`)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
