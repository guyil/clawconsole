import { useState } from 'react';
import { Brain, Calendar, MessageSquare, Pin, ChevronDown, ChevronRight, FileText, Clock, AlertTriangle } from 'lucide-react';
import { Spinner } from '../ui/Spinner';
import { Badge } from '../ui/Badge';
import { useAgentMemoryFiles } from '../../hooks/useAgents';
import type { MemoryFile } from '../../types/memory';

interface MemoryTabProps {
  agentId: string;
}

interface CategorySection {
  key: 'core' | 'daily' | 'sessionSnapshots';
  label: string;
  icon: typeof Pin;
  iconColor: string;
  gradientFrom: string;
  gradientTo: string;
  emptyText: string;
}

const CATEGORIES: CategorySection[] = [
  {
    key: 'core',
    label: '核心记忆',
    icon: Pin,
    iconColor: 'text-red-400',
    gradientFrom: 'from-red-500/25',
    gradientTo: 'to-orange-500/25',
    emptyText: '未找到核心记忆文件（MEMORY.md）',
  },
  {
    key: 'daily',
    label: '每日记忆',
    icon: Calendar,
    iconColor: 'text-blue-400',
    gradientFrom: 'from-blue-500/25',
    gradientTo: 'to-cyan-500/25',
    emptyText: '暂无每日记忆日志',
  },
  {
    key: 'sessionSnapshots',
    label: '会话快照',
    icon: MessageSquare,
    iconColor: 'text-purple-400',
    gradientFrom: 'from-purple-500/25',
    gradientTo: 'to-fuchsia-500/25',
    emptyText: '暂无会话快照',
  },
];

function formatDate(filename: string): string {
  const match = filename.match(/^(\d{4}-\d{2}-\d{2})/);
  if (!match) return filename.replace(/\.md$/, '');
  return match[1];
}

function formatSessionSlug(filename: string): string {
  const withoutExt = filename.replace(/\.md$/, '');
  const match = withoutExt.match(/^\d{4}-\d{2}-\d{2}-(.+)$/);
  if (!match) return withoutExt;
  return match[1].replace(/-/g, ' ');
}

function formatRelativeTime(updatedAt: string): string {
  const diff = Date.now() - new Date(updatedAt).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins}分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  return `${days}天前`;
}

export function MemoryTab({ agentId }: MemoryTabProps) {
  const { data: memoryData, isLoading } = useAgentMemoryFiles(agentId);
  const [selectedFile, setSelectedFile] = useState<MemoryFile | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-8 justify-center text-claw-muted text-sm">
        <Spinner size={16} />
        正在从远程节点读取记忆文件...
      </div>
    );
  }

  const groups = memoryData?.data ?? { core: [], daily: [], sessionSnapshots: [] };
  const totalFiles = memoryData?.totalFiles ?? 0;

  if (totalFiles === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-claw-primary/15 to-claw-accent/15 flex items-center justify-center mb-4">
          <Brain size={28} className="text-claw-muted" />
        </div>
        <h3 className="text-base font-semibold text-claw-text mb-1">暂无记忆文件</h3>
        <p className="text-sm text-claw-muted max-w-sm">
          该 Bot 尚未产生任何记忆。当 Bot 开始对话后，系统会自动生成核心记忆、每日记忆和会话快照。
        </p>
      </div>
    );
  }

  const toggleCollapse = (key: string) => {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const activeFile = selectedFile ?? groups.core[0] ?? groups.daily[0] ?? groups.sessionSnapshots[0] ?? null;

  return (
    <div className="space-y-3">
      {/* Stats bar */}
      <div className="flex items-center gap-4 text-sm">
        <div className="flex items-center gap-1.5 text-claw-muted">
          <Brain size={14} />
          <span>共 {totalFiles} 个记忆文件</span>
        </div>
        {memoryData?.lastSyncedAt && (
          <div className="flex items-center gap-1.5 text-claw-muted">
            <Clock size={14} />
            <span>最后同步: {formatRelativeTime(memoryData.lastSyncedAt)}</span>
          </div>
        )}
        {memoryData?.stale && (
          <div className="flex items-center gap-1.5 text-claw-warning">
            <AlertTriangle size={14} />
            <span>缓存数据（节点不可达）</span>
          </div>
        )}
      </div>

      {/* Main content: sidebar + viewer */}
      <div className="flex gap-4 h-[500px]">
        {/* Sidebar: categorized file list */}
        <div className="w-56 shrink-0 overflow-auto border border-claw-border rounded-xl bg-claw-input">
          {CATEGORIES.map((cat) => {
            const files = groups[cat.key] as MemoryFile[];
            const isCollapsed = collapsed[cat.key] ?? false;
            const Icon = cat.icon;

            return (
              <div key={cat.key}>
                <button
                  onClick={() => toggleCollapse(cat.key)}
                  className="w-full flex items-center justify-between px-3 py-2 border-b border-claw-border hover:bg-claw-card transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-1.5">
                    <Icon size={13} className={cat.iconColor} />
                    <span className="text-xs font-semibold text-claw-muted">{cat.label}</span>
                    <span className="text-xs text-claw-muted">({files.length})</span>
                  </div>
                  {isCollapsed
                    ? <ChevronRight size={12} className="text-claw-muted" />
                    : <ChevronDown size={12} className="text-claw-muted" />
                  }
                </button>

                {!isCollapsed && (
                  <>
                    {files.length === 0 ? (
                      <div className="px-3 py-2 text-xs text-claw-muted border-b border-claw-border">
                        {cat.emptyText}
                      </div>
                    ) : (
                      files.map((file) => {
                        const isActive = activeFile?.relativePath === file.relativePath;
                        return (
                          <button
                            key={file.relativePath}
                            onClick={() => setSelectedFile(file)}
                            className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 border-b border-claw-border last:border-0 cursor-pointer transition-colors
                              ${isActive ? 'bg-claw-primary/15 text-claw-primary-light' : 'text-claw-text hover:bg-claw-card'}`}
                          >
                            <div className={`w-5 h-5 rounded shrink-0 bg-gradient-to-br ${cat.gradientFrom} ${cat.gradientTo} flex items-center justify-center`}>
                              <FileText size={10} className={cat.iconColor} />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-xs font-medium">
                                {cat.key === 'core'
                                  ? file.filename
                                  : cat.key === 'daily'
                                    ? formatDate(file.filename)
                                    : formatSessionSlug(file.filename)}
                              </div>
                              {file.size != null && (
                                <div className="text-[10px] text-claw-muted">
                                  {file.size > 1024
                                    ? `${(file.size / 1024).toFixed(1)} KB`
                                    : `${file.size} B`}
                                </div>
                              )}
                            </div>
                          </button>
                        );
                      })
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>

        {/* Content viewer */}
        <div className="flex-1 flex flex-col border border-claw-border rounded-xl overflow-hidden">
          {activeFile ? (
            <>
              <div className="flex items-center justify-between px-4 py-2 bg-claw-input border-b border-claw-border">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-claw-text font-medium">{activeFile.filename}</span>
                  <Badge variant="muted">只读</Badge>
                  <Badge variant={activeFile.category === 'core' ? 'danger' : activeFile.category === 'daily' ? 'info' : 'muted'}>
                    {activeFile.category === 'core' ? '核心' : activeFile.category === 'daily' ? '每日' : '快照'}
                  </Badge>
                </div>
                {activeFile.updatedAt && (
                  <span className="text-xs text-claw-muted">
                    更新于 {formatRelativeTime(activeFile.updatedAt)}
                  </span>
                )}
              </div>
              <pre className="flex-1 bg-claw-bg text-claw-text text-sm p-4 overflow-auto font-mono whitespace-pre-wrap leading-relaxed">
                {activeFile.content}
              </pre>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-claw-muted text-sm">
              选择一个记忆文件查看
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
