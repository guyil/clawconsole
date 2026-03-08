import { useState, useEffect, useRef } from 'react';
import { useMonitoringSessions, useSessionTranscript, useTriggerTranscriptPull, useTriggerSessionSync } from '../hooks/useMonitoring';
import { useMachines } from '../hooks/useMachines';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { PageSpinner } from '../components/ui/Spinner';
import { EmptyState } from '../components/ui/EmptyState';
import type { SessionSnapshot, SessionMessage } from '../types/monitoring';
import { MessageSquare, Clock, Zap, User, Bot, Terminal, Wrench, RefreshCw } from 'lucide-react';

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return '-';
  const ms = Date.now() - new Date(dateStr).getTime();
  if (ms < 60_000) return '刚刚';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} 分钟前`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)} 小时前`;
  return `${Math.floor(ms / 86_400_000)} 天前`;
}

function SessionKeyLabel({ sessionKey }: { sessionKey: string }) {
  const parts = sessionKey.split(':');
  if (parts[0] === 'agent' && parts.length >= 3) {
    const agentId = parts[1];
    const rest = parts.slice(2).join(':');
    return (
      <span>
        <span className="text-claw-primary-light font-medium">{agentId}</span>
        <span className="text-claw-muted ml-1 text-xs">:{rest}</span>
      </span>
    );
  }
  return <span className="text-sm">{sessionKey}</span>;
}

function RoleIcon({ role }: { role: string }) {
  switch (role) {
    case 'user':
      return <User size={14} className="text-blue-400" />;
    case 'assistant':
      return <Bot size={14} className="text-green-400" />;
    case 'system':
      return <Terminal size={14} className="text-yellow-400" />;
    case 'tool':
      return <Wrench size={14} className="text-purple-400" />;
    default:
      return <MessageSquare size={14} className="text-claw-muted" />;
  }
}

function TranscriptPanel({
  session,
  onClose,
}: {
  session: SessionSnapshot;
  onClose: () => void;
}) {
  const { data, isLoading, isFetched } = useSessionTranscript(
    session.machineId,
    session.sessionId ?? '',
    session.agentId,
  );
  const pullMutation = useTriggerTranscriptPull();
  const autoPulledRef = useRef(false);

  const messages = data?.data ?? [];

  // Auto-pull transcript when panel opens and no cached messages exist
  useEffect(() => {
    if (!isFetched || autoPulledRef.current || pullMutation.isPending) return;
    if (messages.length === 0) {
      autoPulledRef.current = true;
      pullMutation.mutate({
        machineId: session.machineId,
        sessionKey: session.sessionKey,
        agentId: session.agentId,
      });
    }
  }, [isFetched, messages.length, session.machineId, session.sessionKey, session.agentId, pullMutation]);

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex justify-end">
      <div className="w-full max-w-2xl bg-claw-bg border-l border-claw-border flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-claw-border flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-claw-text">会话记录</h3>
            <SessionKeyLabel sessionKey={session.sessionKey} />
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                pullMutation.mutate({
                  machineId: session.machineId,
                  sessionKey: session.sessionKey,
                  agentId: session.agentId,
                })
              }
            >
              <RefreshCw size={14} className={pullMutation.isPending ? 'animate-spin' : ''} />
            </Button>
            <button
              onClick={onClose}
              className="text-claw-muted hover:text-claw-text text-lg cursor-pointer"
            >
              &times;
            </button>
          </div>
        </div>

        {/* Session Info */}
        <div className="px-4 py-2 border-b border-claw-border flex flex-wrap gap-3 text-xs text-claw-muted">
          {session.model && (
            <span>
              Model: <span className="text-claw-text">{session.model}</span>
            </span>
          )}
          {session.channel && (
            <span>
              Channel: <span className="text-claw-text">{session.channel}</span>
            </span>
          )}
          <span>
            Tokens: <span className="text-claw-text">{formatTokens(session.totalTokens)}</span>
          </span>
          {session.originFrom && (
            <span>
              From: <span className="text-claw-text">{session.originFrom}</span>
            </span>
          )}
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {isLoading || pullMutation.isPending ? (
            <PageSpinner />
          ) : messages.length === 0 ? (
            <div className="text-center text-claw-muted text-sm py-8">
              暂无消息记录
            </div>
          ) : (
            messages.map((msg: SessionMessage) => (
              <MessageBubble key={msg.id} message={msg} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: SessionMessage }) {
  const isUser = message.role === 'user';
  const isAssistant = message.role === 'assistant';

  return (
    <div className={`flex gap-2 ${isUser ? 'flex-row-reverse' : ''}`}>
      <div className="mt-1">
        <RoleIcon role={message.role} />
      </div>
      <div
        className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
          isUser
            ? 'bg-claw-primary/20 text-claw-text'
            : isAssistant
              ? 'bg-claw-card text-claw-text border border-claw-border'
              : 'bg-claw-card/50 text-claw-muted border border-claw-border/50 text-xs'
        }`}
      >
        <div className="whitespace-pre-wrap break-words">
          {message.content
            ? message.content.length > 2000
              ? `${message.content.substring(0, 2000)}...`
              : message.content
            : <span className="italic text-claw-muted">(empty)</span>}
        </div>
        <div className="flex items-center gap-2 mt-1 text-[10px] text-claw-muted">
          {message.model && <span>{message.model}</span>}
          {message.totalTokens != null && message.totalTokens > 0 && (
            <span>{formatTokens(message.totalTokens)} tok</span>
          )}
          {message.messageTimestamp && (
            <span>{new Date(message.messageTimestamp).toLocaleTimeString()}</span>
          )}
        </div>
      </div>
    </div>
  );
}

export function SessionsPage() {
  const [machineId, setMachineId] = useState<string>('');
  const [agentId, setAgentId] = useState<string>('');
  const [activeOnly, setActiveOnly] = useState(false);
  const [selectedSession, setSelectedSession] = useState<SessionSnapshot | null>(null);

  const { data: machinesData } = useMachines();
  const machines = machinesData?.data ?? [];
  const syncMutation = useTriggerSessionSync();
  const autoSyncedRef = useRef(false);

  const { data, isLoading } = useMonitoringSessions({
    machineId: machineId || undefined,
    agentId: agentId || undefined,
    activeMinutes: activeOnly ? 30 : undefined,
    limit: 100,
  });

  const sessions = data?.data ?? [];

  // Auto-sync sessions from all machines on page load
  useEffect(() => {
    if (autoSyncedRef.current || machines.length === 0 || syncMutation.isPending) return;
    autoSyncedRef.current = true;
    for (const machine of machines) {
      syncMutation.mutate(machine.id);
    }
  }, [machines, syncMutation]);

  // Collect unique agentIds for filter dropdown
  const uniqueAgents = [...new Set(sessions.map((s) => s.agentId))].sort();

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-lg font-bold text-claw-text">会话监控</h1>
        <div className="flex items-center gap-3">
          {syncMutation.isPending && (
            <span className="flex items-center gap-1.5 text-xs text-claw-primary-light">
              <RefreshCw size={12} className="animate-spin" />
              同步中…
            </span>
          )}
          <div className="text-sm text-claw-muted">{data?.total ?? 0} 个会话</div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-5 flex-wrap">
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

        <select
          value={agentId}
          onChange={(e) => setAgentId(e.target.value)}
          className="bg-claw-card border border-claw-border rounded-lg px-3 py-1.5 text-sm text-claw-text"
        >
          <option value="">全部 Agent</option>
          {uniqueAgents.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>

        <label className="flex items-center gap-1.5 text-sm text-claw-muted cursor-pointer">
          <input
            type="checkbox"
            checked={activeOnly}
            onChange={(e) => setActiveOnly(e.target.checked)}
            className="rounded"
          />
          仅活跃会话
        </label>
      </div>

      {/* Session List */}
      {isLoading ? (
        <PageSpinner />
      ) : sessions.length === 0 ? (
        <EmptyState title="暂无会话数据" description={syncMutation.isPending ? '正在从节点同步会话数据…' : '请确认节点已连接并有会话记录'} />
      ) : (
        <div className="space-y-2">
          {sessions.map((session) => (
            <Card
              key={session.id}
              hover
              className="cursor-pointer"
              onClick={() => setSelectedSession(session)}
            >
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <SessionKeyLabel sessionKey={session.sessionKey} />
                    {session.channel && (
                      <Badge variant="info">{session.channel}</Badge>
                    )}
                    {session.chatType && (
                      <Badge variant="muted">{session.chatType}</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-claw-muted">
                    {session.model && (
                      <span className="flex items-center gap-1">
                        <Zap size={10} />
                        {session.model}
                      </span>
                    )}
                    {session.originFrom && (
                      <span className="flex items-center gap-1">
                        <User size={10} />
                        {session.originFrom}
                      </span>
                    )}
                    <span className="flex items-center gap-1">
                      <Clock size={10} />
                      {timeAgo(session.lastActivityAt)}
                    </span>
                  </div>
                </div>
                <div className="text-right ml-4 shrink-0">
                  <div className="text-sm font-medium text-claw-text">
                    {formatTokens(session.totalTokens)}
                  </div>
                  <div className="text-[10px] text-claw-muted">
                    {formatTokens(session.inputTokens)} in / {formatTokens(session.outputTokens)} out
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Transcript Panel */}
      {selectedSession && (
        <TranscriptPanel
          session={selectedSession}
          onClose={() => setSelectedSession(null)}
        />
      )}
    </div>
  );
}
