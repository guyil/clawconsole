import { useLocation } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { useWebSocketStore } from '../../stores/websocket.store';
import { useAuthStore } from '../../stores/auth.store';
import { StatusDot } from '../ui/StatusDot';
import { logout } from '../../api/auth.api';

const PAGE_TITLES: Record<string, string> = {
  '/': '仪表盘',
  '/machines': '节点管理',
  '/skills': 'Skills 中心',
  '/credentials': '凭证管理',
  '/users': '用户管理',
  '/assistant': 'AI 助手',
  '/settings': '系统设置',
  '/workflows': '工作流',
  '/reviews': '审核收件箱',
};

export function Header() {
  const { pathname } = useLocation();
  const wsConnected = useWebSocketStore((s) => s.connected);
  const user = useAuthStore((s) => s.user);
  const initial = (user?.username?.[0] ?? 'A').toUpperCase();
  const roleLabel = user?.role === 'developer' ? '开发者' : '管理员';

  const basePath = '/' + (pathname.split('/')[1] ?? '');
  const title =
    PAGE_TITLES[basePath] ?? (pathname.startsWith('/machines/') ? '节点详情' : pathname.startsWith('/workflows/runs/') ? '运行详情' : pathname.startsWith('/workflows/runs') ? '运行记录' : pathname.startsWith('/workflows/') ? '工作流编辑' : '');

  return (
    <header className="flex items-center justify-between px-7 py-4 border-b border-claw-border bg-claw-sidebar">
      <h1 className="text-xl font-bold text-claw-text tracking-tight">{title}</h1>
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-claw-success/10 text-claw-success text-xs font-medium">
          <StatusDot status={wsConnected ? 'online' : 'offline'} size={6} />
          {wsConnected ? 'Gateway 在线' : 'Gateway 离线'}
        </div>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-claw-primary to-claw-accent flex items-center justify-center text-white text-xs font-semibold">
            {initial}
          </div>
          {user && (
            <div className="flex flex-col leading-tight">
              <span className="text-xs text-claw-text font-medium">{user.username}</span>
              <span className="text-[10px] text-claw-muted">{roleLabel}</span>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={async () => {
            await logout();
            window.location.reload();
          }}
          title="退出登录"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-claw-muted hover:text-claw-text hover:bg-claw-card transition-colors cursor-pointer"
        >
          <LogOut size={14} />
          退出
        </button>
      </div>
    </header>
  );
}
