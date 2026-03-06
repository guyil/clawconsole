import { useState } from 'react';
import { useMonitoringDashboard, useTriggerSessionSync, useTriggerLogCollection } from '../hooks/useMonitoring';
import { useMachines } from '../hooks/useMachines';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { StatCard } from '../components/ui/StatCard';
import { Button } from '../components/ui/Button';
import { PageSpinner } from '../components/ui/Spinner';
import { Link } from 'react-router-dom';
import type { AgentUsageSummary, DiagnosticEvent } from '../types/monitoring';
import {
  Activity,
  MessageSquare,
  Zap,
  AlertTriangle,
  Bot,
  RefreshCw,
  ArrowRight,
  Clock,
} from 'lucide-react';

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return '-';
  const ms = Date.now() - new Date(dateStr).getTime();
  if (ms < 60_000) return '刚刚';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h`;
  return `${Math.floor(ms / 86_400_000)}d`;
}

function AgentCard({ summary }: { summary: AgentUsageSummary }) {
  return (
    <Card hover>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Bot size={16} className="text-claw-primary-light" />
          <span className="text-sm font-semibold text-claw-text">{summary.agentId}</span>
        </div>
        <Badge variant={summary.lastActivityAt ? 'success' : 'muted'}>
          {summary.lastActivityAt ? timeAgo(summary.lastActivityAt) : 'idle'}
        </Badge>
      </div>
      <div className="grid grid-cols-3 gap-3 text-center">
        <div>
          <div className="text-lg font-bold text-claw-text">{summary.sessionCount}</div>
          <div className="text-[10px] text-claw-muted">会话</div>
        </div>
        <div>
          <div className="text-lg font-bold text-claw-text">{formatTokens(summary.totalTokens)}</div>
          <div className="text-[10px] text-claw-muted">Tokens</div>
        </div>
        <div>
          <div className="text-lg font-bold text-claw-text">
            {formatTokens(summary.totalInputTokens)}
            <span className="text-claw-muted text-xs">/</span>
            {formatTokens(summary.totalOutputTokens)}
          </div>
          <div className="text-[10px] text-claw-muted">In/Out</div>
        </div>
      </div>
    </Card>
  );
}

function RecentEventItem({ event }: { event: DiagnosticEvent }) {
  const isError = event.outcome === 'error' || !!event.errorMessage;
  return (
    <div className="flex items-center justify-between py-2 border-b border-claw-border last:border-0">
      <div className="flex items-center gap-2 min-w-0">
        {isError ? (
          <AlertTriangle size={12} className="text-claw-danger shrink-0" />
        ) : (
          <Zap size={12} className="text-claw-primary-light shrink-0" />
        )}
        <span className="text-xs text-claw-text truncate">{event.eventType}</span>
        {event.channel && (
          <Badge variant="muted">{event.channel}</Badge>
        )}
      </div>
      <span className="text-[10px] text-claw-muted shrink-0 ml-2">
        {new Date(event.eventAt).toLocaleTimeString()}
      </span>
    </div>
  );
}

export function MonitoringDashboardPage() {
  const [machineId, setMachineId] = useState('');
  const { data: machinesData } = useMachines();
  const machines = machinesData?.data ?? [];

  const {
    data: dashboard,
    isLoading,
  } = useMonitoringDashboard(machineId || undefined);

  const syncMutation = useTriggerSessionSync();
  const logsMutation = useTriggerLogCollection();

  if (isLoading) return <PageSpinner />;

  const agentSummaries = dashboard?.agentSummaries ?? [];
  const recentEvents = dashboard?.recentEvents ?? [];

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-lg font-bold text-claw-text">活动监控</h1>
        <div className="flex items-center gap-2">
          <select
            value={machineId}
            onChange={(e) => setMachineId(e.target.value)}
            className="bg-claw-card border border-claw-border rounded-lg px-3 py-1.5 text-sm text-claw-text"
          >
            <option value="">全部节点</option>
            {machines.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          {machineId && (
            <>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => syncMutation.mutate(machineId)}
                disabled={syncMutation.isPending}
              >
                <RefreshCw size={14} className={syncMutation.isPending ? 'animate-spin' : ''} />
                <span className="ml-1">同步会话</span>
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => logsMutation.mutate(machineId)}
                disabled={logsMutation.isPending}
              >
                <RefreshCw size={14} className={logsMutation.isPending ? 'animate-spin' : ''} />
                <span className="ml-1">收集日志</span>
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Stat Cards */}
      <div className="flex gap-4 mb-6 flex-wrap">
        <StatCard
          label="总会话数"
          value={dashboard?.totalSessions ?? 0}
        />
        <StatCard
          label="活跃会话 (30m)"
          value={dashboard?.activeSessions ?? 0}
        />
        <StatCard
          label="总 Tokens"
          value={formatTokens(dashboard?.totalTokens ?? 0)}
        />
        <StatCard
          label="错误 (1h)"
          value={dashboard?.errorCount ?? 0}
        />
      </div>

      {/* Agent Cards + Recent Events */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Agent Usage */}
        <div className="lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-claw-text flex items-center gap-1.5">
              <Bot size={14} className="text-claw-primary-light" />
              Agent 使用概况
            </h2>
            <Link to="/monitoring/sessions" className="text-xs text-claw-primary-light hover:underline flex items-center gap-0.5">
              查看会话 <ArrowRight size={12} />
            </Link>
          </div>
          {agentSummaries.length === 0 ? (
            <Card>
              <p className="text-claw-muted text-sm py-4 text-center">暂无 Agent 数据</p>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {agentSummaries.map((summary) => (
                <AgentCard key={`${summary.machineId}-${summary.agentId}`} summary={summary} />
              ))}
            </div>
          )}
        </div>

        {/* Recent Events */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-claw-text flex items-center gap-1.5">
              <Activity size={14} className="text-claw-primary-light" />
              近期事件
            </h2>
            <Link to="/monitoring/logs" className="text-xs text-claw-primary-light hover:underline flex items-center gap-0.5">
              查看日志 <ArrowRight size={12} />
            </Link>
          </div>
          <Card>
            {recentEvents.length === 0 ? (
              <p className="text-claw-muted text-sm py-4 text-center">暂无事件</p>
            ) : (
              recentEvents.slice(0, 15).map((event) => (
                <RecentEventItem key={event.id} event={event} />
              ))
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
