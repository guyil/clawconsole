import { useState, useCallback } from 'react';
import { Plus, Trash2, MessageSquare, Terminal, Server } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { ChatThread } from '../components/chat/ChatThread';
import { streamAssistantChat } from '../api/assistant.api';
import {
  useAssistantSessions,
  useCreateAssistantSession,
  useDeleteAssistantSession,
} from '../hooks/useAssistant';
import { useMachines } from '../hooks/useMachines';
import type { AssistantSession } from '../types/assistant';

export function AssistantPage() {
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const { data: sessionsData, isLoading: sessionsLoading } = useAssistantSessions();
  const { data: machinesData } = useMachines();
  const createSession = useCreateAssistantSession();
  const deleteSession = useDeleteAssistantSession();

  const sessions = sessionsData?.data ?? [];
  const machines = machinesData?.data ?? [];
  const onlineCount = machines.filter((m) => m.status === 'online').length;

  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null;

  const handleNewSession = useCallback(async () => {
    try {
      const session = await createSession.mutateAsync();
      setActiveSessionId(session.id);
    } catch {
      // handled by API interceptor
    }
  }, [createSession]);

  const handleDeleteSession = useCallback(
    (id: string) => {
      deleteSession.mutate(id);
      if (activeSessionId === id) {
        setActiveSessionId(null);
      }
    },
    [deleteSession, activeSessionId],
  );

  const handleSelectSession = useCallback((session: AssistantSession) => {
    setActiveSessionId(session.id);
  }, []);

  const handleSendMessage = useCallback(
    (message: string) => {
      if (!activeSessionId) {
        return Promise.resolve('Please create a session first.');
      }
      return streamAssistantChat(activeSessionId, message);
    },
    [activeSessionId],
  );

  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60_000);
    if (diffMins < 1) return '刚刚';
    if (diffMins < 60) return `${diffMins}分钟前`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}小时前`;
    return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  };

  return (
    <div className="flex -m-7" style={{ height: 'calc(100% + 3.5rem)' }}>
      {/* Session List Sidebar */}
      <div className="w-64 shrink-0 border-r border-claw-border bg-claw-sidebar flex flex-col">
        {/* Sidebar Header */}
        <div className="flex items-center justify-between px-3 py-3 border-b border-claw-border">
          <div className="flex items-center gap-2">
            <Terminal size={16} className="text-claw-accent" />
            <span className="text-sm font-semibold text-claw-text">AI 助手</span>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={handleNewSession}
            loading={createSession.isPending}
          >
            <Plus size={14} />
          </Button>
        </div>

        {/* Machine Status Bar */}
        <div className="px-3 py-2 border-b border-claw-border/50 bg-claw-bg/30">
          <div className="flex items-center gap-1.5 text-[11px] text-claw-muted">
            <Server size={11} />
            <span>
              {machines.length} 节点 · {onlineCount} 在线
            </span>
            {onlineCount > 0 && (
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            )}
          </div>
        </div>

        {/* Session List */}
        <div className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
          {sessionsLoading ? (
            <div className="flex items-center justify-center py-8 text-claw-muted text-xs">
              加载中...
            </div>
          ) : sessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <MessageSquare size={24} className="text-claw-muted/40 mb-2" />
              <p className="text-xs text-claw-muted">暂无会话</p>
              <p className="text-[11px] text-claw-muted/60 mt-0.5">点击 + 创建新会话</p>
            </div>
          ) : (
            sessions.map((session) => (
              <div
                key={session.id}
                onClick={() => handleSelectSession(session)}
                className={`group flex items-start gap-2 rounded-lg px-2.5 py-2 cursor-pointer transition-all ${
                  session.id === activeSessionId
                    ? 'bg-claw-primary/15 border border-claw-primary/30'
                    : 'hover:bg-claw-card border border-transparent'
                }`}
              >
                <MessageSquare
                  size={13}
                  className={`mt-0.5 shrink-0 ${
                    session.id === activeSessionId ? 'text-claw-primary-light' : 'text-claw-muted'
                  }`}
                />
                <div className="flex-1 min-w-0">
                  <div
                    className={`text-xs font-medium truncate ${
                      session.id === activeSessionId ? 'text-claw-primary-light' : 'text-claw-text'
                    }`}
                  >
                    {session.title ?? '新会话'}
                  </div>
                  <div className="text-[10px] text-claw-muted mt-0.5 flex items-center gap-1.5">
                    <span>{formatTime(session.updatedAt)}</span>
                    {session.messages.length > 0 && (
                      <span>· {session.messages.length} 条消息</span>
                    )}
                  </div>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteSession(session.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 p-0.5 text-claw-muted hover:text-claw-danger transition-all"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {activeSession ? (
          <ChatThread
            onSendMessage={handleSendMessage}
            placeholder="输入指令，例如：帮我在北京节点安装 Chrome..."
            header={
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-claw-border bg-claw-sidebar/20">
                <div className="flex items-center gap-2">
                  <Terminal size={15} className="text-claw-accent" />
                  <span className="text-sm font-medium text-claw-text">
                    {activeSession.title ?? '新会话'}
                  </span>
                  <Badge variant="muted">
                    {activeSession.messages.length} 条消息
                  </Badge>
                </div>
                <div className="flex items-center gap-2">
                  {onlineCount > 0 && (
                    <Badge variant="success">{onlineCount} 节点在线</Badge>
                  )}
                </div>
              </div>
            }
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center px-8">
            <div className="w-16 h-16 rounded-2xl bg-claw-primary/10 flex items-center justify-center mb-4">
              <Terminal size={28} className="text-claw-primary-light" />
            </div>
            <h2 className="text-lg font-semibold text-claw-text mb-2">AI 运维助手</h2>
            <p className="text-sm text-claw-muted max-w-md mb-6">
              通过自然语言管理你的 OpenClaw 集群。支持 SSH 命令执行、健康检查、查看 Agent
              状态等操作。
            </p>
            <div className="grid grid-cols-2 gap-3 text-left max-w-md w-full mb-8">
              <ExampleCard
                title="安装软件"
                example="帮我在所有节点上安装 htop"
              />
              <ExampleCard
                title="检查状态"
                example="查看所有节点的健康状态"
              />
              <ExampleCard
                title="查看日志"
                example="看看北京节点的 OpenClaw 日志"
              />
              <ExampleCard
                title="管理服务"
                example="重启上海节点的 Gateway 服务"
              />
            </div>
            <Button variant="primary" onClick={handleNewSession} loading={createSession.isPending}>
              <Plus size={14} />
              开始新会话
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function ExampleCard({ title, example }: { title: string; example: string }) {
  return (
    <div className="bg-claw-card/50 border border-claw-border/50 rounded-xl px-3 py-2.5">
      <div className="text-xs font-medium text-claw-text mb-1">{title}</div>
      <div className="text-[11px] text-claw-muted leading-relaxed">"{example}"</div>
    </div>
  );
}
