import { useMachines } from '../hooks/useMachines';
import { useSkills } from '../hooks/useSkills';
import { useWebSocketStore } from '../stores/websocket.store';
import { StatCard } from '../components/ui/StatCard';
import { StatusDot } from '../components/ui/StatusDot';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { PageSpinner } from '../components/ui/Spinner';
import { Link } from 'react-router-dom';
import { Server, ArrowRightLeft, Puzzle, Activity } from 'lucide-react';

export function DashboardPage() {
  const { data: machinesData, isLoading: machinesLoading } = useMachines();
  const { data: skillsData, isLoading: skillsLoading } = useSkills();
  const wsEvents = useWebSocketStore((s) => s.events);

  if (machinesLoading || skillsLoading) return <PageSpinner />;

  const machines = machinesData?.data ?? [];
  const onlineMachines = machines.filter((m) => m.status === 'online').length;
  const totalAgents = machines.reduce((sum, m) => sum + (m.agentCount ?? 0), 0);
  const totalSkills = skillsData?.total ?? 0;

  const syncEvents = wsEvents.filter((e) => e.type.startsWith('sync:'));

  return (
    <div>
      {/* Stat Cards */}
      <div className="flex gap-4 mb-7 flex-wrap">
        <StatCard label="在线节点" value={`${onlineMachines}/${machines.length}`} />
        <StatCard label="Agent 总数" value={totalAgents} />
        <StatCard label="Skills 总数" value={totalSkills} />
        <StatCard label="实时事件" value={syncEvents.length} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Machine Status */}
        <Card>
          <div className="flex items-center gap-2 mb-4">
            <Server size={16} className="text-claw-primary-light" />
            <span className="text-base font-semibold">节点状态概览</span>
          </div>
          {machines.length === 0 ? (
            <p className="text-claw-muted text-sm py-4">
              暂无节点，请前往
              <Link to="/machines" className="text-claw-primary-light ml-1 hover:underline">
                节点管理
              </Link>
              添加
            </p>
          ) : (
            machines.map((machine) => (
              <Link
                key={machine.id}
                to={`/machines/${machine.id}`}
                className="flex items-center justify-between py-2.5 border-b border-claw-border last:border-0 hover:bg-claw-card-hover -mx-5 px-5 transition-colors"
              >
                <div className="flex items-center gap-2.5">
                  <StatusDot status={machine.status} />
                  <span className="text-sm text-claw-text">{machine.name}</span>
                  <span className="text-xs text-claw-muted">{machine.tailscaleHostname}</span>
                </div>
                <div className="flex gap-4 text-xs text-claw-muted">
                  <span>{machine.agentCount ?? 0} agents</span>
                  {machine.openclawVersion && (
                    <span>v{machine.openclawVersion}</span>
                  )}
                </div>
              </Link>
            ))
          )}
        </Card>

        {/* Recent Sync Events */}
        <Card>
          <div className="flex items-center gap-2 mb-4">
            <Activity size={16} className="text-claw-primary-light" />
            <span className="text-base font-semibold">实时同步事件</span>
          </div>
          {syncEvents.length === 0 ? (
            <p className="text-claw-muted text-sm py-4">暂无同步事件</p>
          ) : (
            syncEvents.slice(0, 8).map((evt, i) => {
              const typeLabels: Record<string, { label: string; variant: 'success' | 'warning' | 'danger' | 'info' | 'muted' }> = {
                'sync:started': { label: '开始同步', variant: 'info' },
                'sync:progress': { label: '同步进度', variant: 'info' },
                'sync:completed': { label: '同步完成', variant: 'success' },
                'sync:conflict': { label: '冲突', variant: 'warning' },
                'machine:status': { label: '状态变更', variant: 'muted' },
              };
              const cfg = typeLabels[evt.type] ?? { label: evt.type, variant: 'muted' as const };
              return (
                <div
                  key={i}
                  className="flex items-center justify-between py-2.5 border-b border-claw-border last:border-0"
                >
                  <div>
                    <div className="text-sm text-claw-text">{cfg.label}</div>
                    <div className="text-xs text-claw-muted mt-0.5">
                      {new Date(evt.timestamp).toLocaleTimeString()}
                    </div>
                  </div>
                  <Badge variant={cfg.variant}>{evt.type.split(':')[1]}</Badge>
                </div>
              );
            })
          )}
        </Card>
      </div>

      {/* Quick Actions */}
      <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Link to="/machines">
          <Card hover className="flex items-center gap-3">
            <Server size={20} className="text-claw-primary-light" />
            <div>
              <div className="text-sm font-semibold">管理节点</div>
              <div className="text-xs text-claw-muted">注册、发现、同步</div>
            </div>
          </Card>
        </Link>
        <Link to="/skills">
          <Card hover className="flex items-center gap-3">
            <Puzzle size={20} className="text-claw-primary-light" />
            <div>
              <div className="text-sm font-semibold">Skills 中心</div>
              <div className="text-xs text-claw-muted">管理和分发 Skills</div>
            </div>
          </Card>
        </Link>
        <Link to="/credentials">
          <Card hover className="flex items-center gap-3">
            <ArrowRightLeft size={20} className="text-claw-primary-light" />
            <div>
              <div className="text-sm font-semibold">凭证管理</div>
              <div className="text-xs text-claw-muted">API Keys 和密钥</div>
            </div>
          </Card>
        </Link>
      </div>
    </div>
  );
}
