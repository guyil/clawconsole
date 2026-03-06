import { useWebSocketStore } from '../stores/websocket.store';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { StatusDot } from '../components/ui/StatusDot';
import { useMachines } from '../hooks/useMachines';
import { useSkills } from '../hooks/useSkills';
import { useCredentials } from '../hooks/useCredentials';
import { Server, Puzzle, KeyRound, Wifi } from 'lucide-react';

export function SettingsPage() {
  const wsConnected = useWebSocketStore((s) => s.connected);
  const { data: machines } = useMachines();
  const { data: skills } = useSkills();
  const { data: credentials } = useCredentials();

  const infoItems = [
    {
      icon: <Server size={18} />,
      label: '节点总数',
      value: machines?.total ?? 0,
      sub: `${machines?.data.filter((m) => m.status === 'online').length ?? 0} 在线`,
    },
    {
      icon: <Puzzle size={18} />,
      label: 'Skills 总数',
      value: skills?.total ?? 0,
      sub: `${skills?.data.filter((s) => s.reviewStatus === 'approved').length ?? 0} 已审核`,
    },
    {
      icon: <KeyRound size={18} />,
      label: '凭证总数',
      value: credentials?.total ?? 0,
      sub: '加密存储',
    },
    {
      icon: <Wifi size={18} />,
      label: 'WebSocket',
      value: wsConnected ? '已连接' : '未连接',
      sub: wsConnected ? 'ws://localhost:3000/ws' : '正在尝试重连...',
    },
  ];

  return (
    <div className="max-w-3xl">
      {/* System Info */}
      <h2 className="text-base font-semibold mb-4">系统信息</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
        {infoItems.map((item) => (
          <Card key={item.label} className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg bg-claw-primary/15 flex items-center justify-center text-claw-primary-light">
              {item.icon}
            </div>
            <div>
              <div className="text-sm font-semibold text-claw-text">{item.value}</div>
              <div className="text-xs text-claw-muted">
                {item.label} · {item.sub}
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* Connection status */}
      <h2 className="text-base font-semibold mb-4">连接状态</h2>
      <Card className="mb-8">
        <div className="flex items-center gap-3 mb-4">
          <StatusDot status={wsConnected ? 'online' : 'offline'} />
          <span className="text-sm text-claw-text">
            {wsConnected ? 'WebSocket 已连接' : 'WebSocket 未连接'}
          </span>
        </div>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-claw-muted">后端 API</span>
            <span className="text-claw-text">http://localhost:3000/api</span>
          </div>
          <div className="flex justify-between">
            <span className="text-claw-muted">WebSocket</span>
            <span className="text-claw-text">ws://localhost:3000/ws</span>
          </div>
          <div className="flex justify-between">
            <span className="text-claw-muted">数据库</span>
            <span className="text-claw-text">MySQL 8.0+</span>
          </div>
          <div className="flex justify-between">
            <span className="text-claw-muted">缓存</span>
            <span className="text-claw-text">Redis 7.x</span>
          </div>
        </div>
      </Card>

      {/* About */}
      <h2 className="text-base font-semibold mb-4">关于</h2>
      <Card>
        <div className="flex items-center gap-3 mb-3">
          <span className="text-2xl">🦞</span>
          <div>
            <div className="text-base font-bold text-claw-text">ClawConsole</div>
            <div className="text-xs text-claw-muted">OpenClaw Bot 管理控制台</div>
          </div>
          <Badge variant="info" className="ml-auto">v1.0.0</Badge>
        </div>
        <p className="text-sm text-claw-muted">
          ClawConsole 提供集中化管理 OpenClaw Bot 实例的能力，通过 Tailscale SSH
          安全通道进行文件同步，支持多节点管理、Skills 分发、凭证管理和实时状态监控。
        </p>
      </Card>
    </div>
  );
}
