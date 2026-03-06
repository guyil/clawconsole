import { Link } from 'react-router-dom';
import { StatusDot } from '../ui/StatusDot';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { HeartPulse, Search, Trash2 } from 'lucide-react';
import type { Machine } from '../../types/machine';

interface Props {
  machine: Machine;
  onHealthCheck: (id: string) => void;
  onDiscover: (id: string) => void;
  onDelete: (id: string) => void;
  healthCheckLoading?: boolean;
  discoverLoading?: boolean;
}

export function MachineCard({
  machine,
  onHealthCheck,
  onDiscover,
  onDelete,
  healthCheckLoading,
  discoverLoading,
}: Props) {
  return (
    <div className="bg-claw-card rounded-xl border border-claw-border p-5 hover:bg-claw-card-hover transition-all">
      {/* Header */}
      <div className="flex justify-between items-start mb-4">
        <Link to={`/machines/${machine.id}`} className="flex items-center gap-2.5 group">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-claw-primary/25 to-claw-accent/25 flex items-center justify-center text-base">
            🦞
          </div>
          <div>
            <div className="text-[15px] font-semibold text-claw-text group-hover:text-claw-primary-light transition-colors">
              {machine.name}
            </div>
            <div className="text-xs text-claw-muted">{machine.tailscaleHostname}</div>
          </div>
        </Link>
        <StatusDot status={machine.status} />
      </div>

      {/* Stats */}
      <div className="flex gap-3 flex-wrap mb-4">
        {[
          { label: 'Agents', value: machine.agentCount ?? 0 },
          { label: '共享Skills', value: machine.discoveredSkills?.length ?? 0 },
          { label: '版本', value: machine.openclawVersion ?? '-' },
          { label: '状态', value: machine.status === 'online' ? '在线' : machine.status === 'offline' ? '离线' : '未知' },
        ].map((s) => (
          <div
            key={s.label}
            className="flex-1 min-w-[60px] text-center py-2 bg-claw-input rounded-lg"
          >
            <div className="text-[11px] text-claw-muted">{s.label}</div>
            <div className="text-sm font-semibold text-claw-text mt-0.5">{s.value}</div>
          </div>
        ))}
      </div>

      {/* Tags */}
      {machine.tags && machine.tags.length > 0 && (
        <div className="flex gap-1.5 flex-wrap mb-3">
          {machine.tags.map((tag) => (
            <Badge key={tag} variant="muted">{tag}</Badge>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        <Button
          variant="secondary"
          size="sm"
          icon={<HeartPulse size={14} />}
          onClick={() => onHealthCheck(machine.id)}
          loading={healthCheckLoading}
          className="flex-1"
        >
          健康检查
        </Button>
        <Button
          variant="secondary"
          size="sm"
          icon={<Search size={14} />}
          onClick={() => onDiscover(machine.id)}
          loading={discoverLoading}
          className="flex-1"
        >
          发现
        </Button>
        <Button
          variant="ghost"
          size="sm"
          icon={<Trash2 size={14} />}
          onClick={() => onDelete(machine.id)}
          className="text-claw-danger hover:bg-claw-danger/10"
        />
      </div>
    </div>
  );
}
