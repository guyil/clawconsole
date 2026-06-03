import { useEffect, useState, type ComponentType } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Server,
  Bot,
  Puzzle,
  KeyRound,
  Settings,
  ChevronLeft,
  ChevronDown,
  Shell,
  Activity,
  MessageSquare,
  FileText,
  FileBarChart,
  FlaskConical,
  Terminal,
  Workflow,
  MonitorCheck,
} from 'lucide-react';
import { useUIStore } from '../../stores/ui.store';

type IconType = ComponentType<{ size?: number; className?: string }>;

interface LeafItem {
  to: string;
  label: string;
  icon: IconType;
}

interface GroupItem {
  label: string;
  icon: IconType;
  /**
   * URL prefix that triggers auto-expand when the current route is inside it.
   * Also used to highlight the parent row while any child is active.
   */
  prefix: string;
  children: LeafItem[];
}

type NavItem = LeafItem | GroupItem;

function isGroup(item: NavItem): item is GroupItem {
  return 'children' in item;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: '仪表盘', icon: LayoutDashboard },
  { to: '/machines', label: '节点管理', icon: Server },
  { to: '/bots', label: 'Bot 管理', icon: Bot },
  {
    label: '监测',
    icon: MonitorCheck,
    prefix: '/monitoring',
    children: [
      { to: '/monitoring', label: '活动监控', icon: Activity },
      { to: '/monitoring/sessions', label: '会话监控', icon: MessageSquare },
      { to: '/monitoring/logs', label: '日志监控', icon: FileText },
      { to: '/monitoring/summaries', label: '会话总结', icon: FileBarChart },
    ],
  },
  { to: '/workflows', label: '工作流', icon: Workflow },
  { to: '/skills', label: 'Skills 中心', icon: Puzzle },
  { to: '/playground', label: 'Skills Playground', icon: FlaskConical },
  { to: '/assistant', label: 'AI 助手', icon: Terminal },
  { to: '/credentials', label: '凭证管理', icon: KeyRound },
  { to: '/settings', label: '系统设置', icon: Settings },
];

export function Sidebar() {
  const collapsed = useUIStore((s) => s.sidebarCollapsed);
  const toggle = useUIStore((s) => s.toggleSidebar);
  const location = useLocation();

  // Auto-expand any group that matches the active route. Users can still
  // toggle groups manually, but the initial render always reveals the
  // currently active section so the user isn't lost after navigation.
  const initialOpen: Record<string, boolean> = {};
  for (const item of NAV_ITEMS) {
    if (isGroup(item) && location.pathname.startsWith(item.prefix)) {
      initialOpen[item.label] = true;
    }
  }
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(initialOpen);

  useEffect(() => {
    setOpenGroups((prev) => {
      const next = { ...prev };
      for (const item of NAV_ITEMS) {
        if (isGroup(item) && location.pathname.startsWith(item.prefix)) {
          next[item.label] = true;
        }
      }
      return next;
    });
  }, [location.pathname]);

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
      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
        {NAV_ITEMS.map((item) => {
          if (!isGroup(item)) {
            return (
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
            );
          }

          // Group item (parent + collapsible children).
          // When the sidebar itself is collapsed to icon-only mode, we don't
          // have room for a disclosure; render the children as flat icons
          // directly (users can still tell them apart by icon) to avoid
          // hiding navigation options entirely.
          const isOpen = openGroups[item.label] ?? false;
          const anyActive = item.children.some((c) => {
            if (c.to === '/monitoring') return location.pathname === '/monitoring';
            return location.pathname.startsWith(c.to);
          });

          if (collapsed) {
            return (
              <div key={item.label} className="space-y-0.5">
                <div className="flex justify-center py-2 text-claw-muted">
                  <item.icon size={16} />
                </div>
                {item.children.map((c) => (
                  <NavLink
                    key={c.to}
                    to={c.to}
                    end={c.to === '/monitoring'}
                    className={({ isActive }) =>
                      `flex items-center justify-center py-2.5 rounded-lg transition-all duration-150 ${
                        isActive
                          ? 'bg-claw-primary/20 text-claw-primary-light font-semibold'
                          : 'text-claw-muted hover:text-claw-text hover:bg-claw-card'
                      }`
                    }
                  >
                    <c.icon size={16} />
                  </NavLink>
                ))}
              </div>
            );
          }

          return (
            <div key={item.label}>
              <button
                type="button"
                onClick={() =>
                  setOpenGroups((prev) => ({ ...prev, [item.label]: !isOpen }))
                }
                className={`w-full flex items-center gap-3 rounded-lg transition-all duration-150 px-3.5 py-2.5 cursor-pointer ${
                  anyActive
                    ? 'text-claw-text font-semibold'
                    : 'text-claw-muted hover:text-claw-text hover:bg-claw-card'
                }`}
              >
                <item.icon size={18} />
                <span className="text-sm flex-1 text-left">{item.label}</span>
                <ChevronDown
                  size={14}
                  className={`transition-transform duration-150 ${isOpen ? '' : '-rotate-90'}`}
                />
              </button>
              {isOpen && (
                <div className="mt-0.5 ml-3 pl-3 border-l border-claw-border space-y-0.5">
                  {item.children.map((c) => (
                    <NavLink
                      key={c.to}
                      to={c.to}
                      end={c.to === '/monitoring'}
                      className={({ isActive }) =>
                        `flex items-center gap-2.5 rounded-lg transition-all duration-150 px-3 py-2 ${
                          isActive
                            ? 'bg-claw-primary/20 text-claw-primary-light font-semibold'
                            : 'text-claw-muted hover:text-claw-text hover:bg-claw-card'
                        }`
                      }
                    >
                      <c.icon size={14} />
                      <span className="text-sm">{c.label}</span>
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          );
        })}
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
