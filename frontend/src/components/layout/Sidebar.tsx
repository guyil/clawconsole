import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Server,
  Bot,
  Puzzle,
  KeyRound,
  Settings,
  ChevronLeft,
  Shell,
  Activity,
  MessageSquare,
  FileText,
  FlaskConical,
  Workflow,
  Play,
  UserCheck,
} from 'lucide-react';
import { useUIStore } from '../../stores/ui.store';

const NAV_ITEMS = [
  { to: '/', label: '仪表盘', icon: LayoutDashboard },
  { to: '/machines', label: '节点管理', icon: Server },
  { to: '/bots', label: 'Bot 管理', icon: Bot },
  { to: '/monitoring', label: '活动监控', icon: Activity },
  { to: '/monitoring/sessions', label: '会话监控', icon: MessageSquare },
  { to: '/monitoring/logs', label: '日志监控', icon: FileText },
  { to: '/workflows', label: '工作流', icon: Workflow },
  { to: '/workflows/runs', label: '运行记录', icon: Play },
  { to: '/reviews', label: '审核收件箱', icon: UserCheck },
  { to: '/skills', label: 'Skills 中心', icon: Puzzle },
  { to: '/playground', label: 'Skills Playground', icon: FlaskConical },
  { to: '/credentials', label: '凭证管理', icon: KeyRound },
  { to: '/settings', label: '系统设置', icon: Settings },
];

export function Sidebar() {
  const collapsed = useUIStore((s) => s.sidebarCollapsed);
  const toggle = useUIStore((s) => s.toggleSidebar);

  return (
    <div
      className="flex flex-col bg-claw-sidebar border-r border-claw-border shrink-0 transition-[width] duration-250 ease-in-out"
      style={{ width: collapsed ? 64 : 220 }}
    >
      {/* Logo */}
      <div
        className={`flex items-center border-b border-claw-border ${
          collapsed ? 'justify-center px-3 py-5' : 'justify-between px-5 py-5'
        }`}
      >
        {!collapsed && (
          <div className="flex items-center gap-2.5">
            <Shell size={22} className="text-claw-accent" />
            <span className="text-claw-text font-bold text-base tracking-tight">
              ClawConsole
            </span>
          </div>
        )}
        {collapsed && <Shell size={22} className="text-claw-accent" />}
        {!collapsed && (
          <button
            onClick={toggle}
            className="text-claw-muted hover:text-claw-text transition-colors cursor-pointer"
          >
            <ChevronLeft size={16} />
          </button>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 py-3 space-y-0.5">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-lg transition-all duration-150 ${
                collapsed ? 'justify-center py-3' : 'px-3.5 py-2.5'
              } ${
                isActive
                  ? 'bg-claw-primary/20 text-claw-primary-light font-semibold'
                  : 'text-claw-muted hover:text-claw-text hover:bg-claw-card'
              }`
            }
          >
            <item.icon size={18} />
            {!collapsed && <span className="text-sm">{item.label}</span>}
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      {!collapsed && (
        <div className="px-5 py-4 border-t border-claw-border text-[11px] text-claw-muted">
          OpenClaw Console v1.0
        </div>
      )}

      {/* Expand button when collapsed */}
      {collapsed && (
        <div className="py-4 flex justify-center border-t border-claw-border">
          <button
            onClick={toggle}
            className="text-claw-muted hover:text-claw-text transition-colors cursor-pointer"
          >
            <ChevronLeft size={16} className="rotate-180" />
          </button>
        </div>
      )}
    </div>
  );
}
