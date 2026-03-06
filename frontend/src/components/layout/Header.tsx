import { useLocation } from 'react-router-dom';
import { useWebSocketStore } from '../../stores/websocket.store';
import { StatusDot } from '../ui/StatusDot';

const PAGE_TITLES: Record<string, string> = {
  '/': '仪表盘',
  '/machines': '节点管理',
  '/skills': 'Skills 中心',
  '/credentials': '凭证管理',
  '/assistant': 'AI 助手',
  '/settings': '系统设置',
};

export function Header() {
  const { pathname } = useLocation();
  const wsConnected = useWebSocketStore((s) => s.connected);

  const basePath = '/' + (pathname.split('/')[1] ?? '');
  const title =
    PAGE_TITLES[basePath] ?? (pathname.startsWith('/machines/') ? '节点详情' : '');

  return (
    <header className="flex items-center justify-between px-7 py-4 border-b border-claw-border bg-claw-sidebar">
      <h1 className="text-xl font-bold text-claw-text tracking-tight">{title}</h1>
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-claw-success/10 text-claw-success text-xs font-medium">
          <StatusDot status={wsConnected ? 'online' : 'offline'} size={6} />
          {wsConnected ? 'Gateway 在线' : 'Gateway 离线'}
        </div>
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-claw-primary to-claw-accent flex items-center justify-center text-white text-xs font-semibold">
          A
        </div>
      </div>
    </header>
  );
}
