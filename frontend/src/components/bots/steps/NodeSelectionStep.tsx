import { useState, useMemo } from 'react';
import { useMachines } from '../../../hooks/useMachines';
import { Card } from '../../ui/Card';
import { StatusDot } from '../../ui/StatusDot';
import { Badge } from '../../ui/Badge';
import { PageSpinner } from '../../ui/Spinner';
import { EmptyState } from '../../ui/EmptyState';
import { Server, Search, Clock, Bot } from 'lucide-react';
import type { Machine } from '../../../types/machine';

interface NodeSelectionStepProps {
  selectedMachineId: string | null;
  onSelect: (machine: Machine) => void;
}

export function NodeSelectionStep({ selectedMachineId, onSelect }: NodeSelectionStepProps) {
  const { data, isLoading } = useMachines();
  const [search, setSearch] = useState('');

  const machines = data?.data ?? [];

  const filtered = useMemo(() => {
    if (!search.trim()) return machines;
    const q = search.toLowerCase();
    return machines.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.tailscaleHostname.toLowerCase().includes(q) ||
        (m.tags ?? []).some((t) => t.toLowerCase().includes(q)),
    );
  }, [machines, search]);

  if (isLoading) return <PageSpinner />;

  const onlineNodes = machines.filter((m) => m.status === 'online');

  if (machines.length === 0) {
    return (
      <EmptyState
        icon={<Server size={48} />}
        title="无可用节点"
        description="请先在节点管理中注册节点并确保节点在线"
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-claw-muted" />
          <input
            type="text"
            placeholder="搜索节点名称或标签..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm bg-claw-bg border border-claw-border rounded-lg text-claw-text placeholder:text-claw-muted focus:outline-none focus:border-claw-primary"
          />
        </div>
        <span className="text-xs text-claw-muted whitespace-nowrap">
          {onlineNodes.length}/{machines.length} 在线
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-8 text-sm text-claw-muted">无匹配节点</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[400px] overflow-y-auto pr-1">
          {filtered.map((machine) => {
            const isOnline = machine.status === 'online';
            const isSelected = machine.id === selectedMachineId;

            return (
              <Card
                key={machine.id}
                hover={isOnline}
                selected={isSelected}
                padding="p-4"
                className={!isOnline ? 'opacity-50 cursor-not-allowed' : ''}
                onClick={() => isOnline && onSelect(machine)}
                title={!isOnline ? '节点离线，无法部署' : undefined}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-claw-primary/10 flex items-center justify-center">
                      <Server size={16} className="text-claw-primary-light" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-claw-text">{machine.name}</div>
                      <div className="text-[11px] text-claw-muted">{machine.tailscaleHostname}</div>
                    </div>
                  </div>
                  <StatusDot status={machine.status} />
                </div>

                <div className="flex items-center gap-3 mt-3 text-[11px] text-claw-muted">
                  {machine.openclawVersion && (
                    <Badge variant="muted">v{machine.openclawVersion}</Badge>
                  )}
                  {machine.agentCount != null && (
                    <span className="flex items-center gap-1">
                      <Bot size={11} />
                      {machine.agentCount} Bots
                    </span>
                  )}
                  {machine.lastHealthCheckAt && (
                    <span className="flex items-center gap-1">
                      <Clock size={11} />
                      {new Date(machine.lastHealthCheckAt).toLocaleDateString()}
                    </span>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
