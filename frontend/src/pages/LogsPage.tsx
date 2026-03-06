import { useState } from 'react';
import { useMonitoringLogs, useMonitoringEvents, useTriggerLogCollection } from '../hooks/useMonitoring';
import { useMachines } from '../hooks/useMachines';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { PageSpinner } from '../components/ui/Spinner';
import { EmptyState } from '../components/ui/EmptyState';
import type { GatewayLog, DiagnosticEvent } from '../types/monitoring';
import { FileText, AlertTriangle, RefreshCw, Search, Zap } from 'lucide-react';

type TabId = 'logs' | 'events';

const LOG_SOURCE_LABELS: Record<string, string> = {
  gateway: 'Gateway',
  command: '命令',
  config_audit: '配置审计',
  cron_run: 'Cron',
};

const LEVEL_VARIANTS: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'muted'> = {
  error: 'danger',
  warn: 'warning',
  info: 'info',
  debug: 'muted',
  fatal: 'danger',
};

function LogEntry({ log: entry }: { log: GatewayLog }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className="border-b border-claw-border py-2.5 px-4 hover:bg-claw-card-hover cursor-pointer transition-colors"
      onClick={() => setExpanded(!expanded)}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {entry.level && (
              <Badge variant={LEVEL_VARIANTS[entry.level] ?? 'muted'}>
                {entry.level}
              </Badge>
            )}
            <Badge variant="muted">{LOG_SOURCE_LABELS[entry.logSource] ?? entry.logSource}</Badge>
            {entry.subsystem && (
              <span className="text-xs text-claw-muted">{entry.subsystem}</span>
            )}
          </div>
          <p className="text-sm text-claw-text mt-1 break-words">
            {entry.message
              ? entry.message.length > 300
                ? `${entry.message.substring(0, 300)}...`
                : entry.message
              : <span className="text-claw-muted italic">(no message)</span>}
          </p>
          {expanded && entry.extraData && (
            <pre className="text-xs text-claw-muted mt-2 bg-claw-bg p-2 rounded overflow-x-auto">
              {JSON.stringify(entry.extraData, null, 2)}
            </pre>
          )}
        </div>
        <div className="text-xs text-claw-muted shrink-0 text-right">
          <div>{new Date(entry.loggedAt).toLocaleTimeString()}</div>
          <div>{new Date(entry.loggedAt).toLocaleDateString()}</div>
        </div>
      </div>
      {entry.sessionKey && (
        <div className="text-[10px] text-claw-muted mt-1">
          Session: {entry.sessionKey}
        </div>
      )}
    </div>
  );
}

function EventEntry({ event }: { event: DiagnosticEvent }) {
  const isError =
    event.outcome === 'error' || !!event.errorMessage;

  return (
    <div className="border-b border-claw-border py-2.5 px-4 hover:bg-claw-card-hover transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <Badge variant={isError ? 'danger' : 'info'}>
              {event.eventType}
            </Badge>
            {event.outcome && (
              <Badge variant={event.outcome === 'error' ? 'danger' : 'success'}>
                {event.outcome}
              </Badge>
            )}
            {event.channel && (
              <span className="text-xs text-claw-muted">{event.channel}</span>
            )}
          </div>
          {event.errorMessage && (
            <p className="text-sm text-claw-danger mt-1">{event.errorMessage}</p>
          )}
          {event.model && (
            <div className="text-xs text-claw-muted mt-1">
              Model: {event.provider ? `${event.provider}/` : ''}{event.model}
            </div>
          )}
          {event.durationMs != null && (
            <div className="text-xs text-claw-muted mt-0.5">
              Duration: {event.durationMs}ms
            </div>
          )}
        </div>
        <div className="text-xs text-claw-muted shrink-0 text-right">
          <div>{new Date(event.eventAt).toLocaleTimeString()}</div>
          <div>{new Date(event.eventAt).toLocaleDateString()}</div>
        </div>
      </div>
      {event.sessionKey && (
        <div className="text-[10px] text-claw-muted mt-1">
          Session: {event.sessionKey}
        </div>
      )}
    </div>
  );
}

export function LogsPage() {
  const [tab, setTab] = useState<TabId>('logs');
  const [machineId, setMachineId] = useState('');
  const [logSource, setLogSource] = useState('');
  const [level, setLevel] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [eventType, setEventType] = useState('');

  const { data: machinesData } = useMachines();
  const machines = machinesData?.data ?? [];

  const collectMutation = useTriggerLogCollection();

  const {
    data: logsData,
    isLoading: logsLoading,
  } = useMonitoringLogs({
    machineId: machineId || undefined,
    logSource: logSource || undefined,
    level: level || undefined,
    query: searchQuery || undefined,
    limit: 200,
  });

  const {
    data: eventsData,
    isLoading: eventsLoading,
  } = useMonitoringEvents({
    machineId: machineId || undefined,
    eventType: eventType || undefined,
    limit: 200,
  });

  const logs = logsData?.data ?? [];
  const events = eventsData?.data ?? [];

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-lg font-bold text-claw-text">日志监控</h1>
        {machineId && (
          <Button
            size="sm"
            onClick={() => collectMutation.mutate(machineId)}
            disabled={collectMutation.isPending}
          >
            <RefreshCw size={14} className={collectMutation.isPending ? 'animate-spin mr-1' : 'mr-1'} />
            收集日志
          </Button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-claw-border mb-4">
        <button
          onClick={() => setTab('logs')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors cursor-pointer ${
            tab === 'logs'
              ? 'border-claw-primary-light text-claw-primary-light'
              : 'border-transparent text-claw-muted hover:text-claw-text'
          }`}
        >
          <FileText size={14} className="inline mr-1.5" />
          运行日志
        </button>
        <button
          onClick={() => setTab('events')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors cursor-pointer ${
            tab === 'events'
              ? 'border-claw-primary-light text-claw-primary-light'
              : 'border-transparent text-claw-muted hover:text-claw-text'
          }`}
        >
          <Zap size={14} className="inline mr-1.5" />
          诊断事件
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
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

        {tab === 'logs' && (
          <>
            <select
              value={logSource}
              onChange={(e) => setLogSource(e.target.value)}
              className="bg-claw-card border border-claw-border rounded-lg px-3 py-1.5 text-sm text-claw-text"
            >
              <option value="">全部来源</option>
              <option value="gateway">Gateway</option>
              <option value="command">命令</option>
              <option value="config_audit">配置审计</option>
              <option value="cron_run">Cron</option>
            </select>

            <select
              value={level}
              onChange={(e) => setLevel(e.target.value)}
              className="bg-claw-card border border-claw-border rounded-lg px-3 py-1.5 text-sm text-claw-text"
            >
              <option value="">全部级别</option>
              <option value="error">Error</option>
              <option value="warn">Warn</option>
              <option value="info">Info</option>
              <option value="debug">Debug</option>
            </select>

            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-claw-muted" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索日志..."
                className="bg-claw-card border border-claw-border rounded-lg pl-8 pr-3 py-1.5 text-sm text-claw-text w-52"
              />
            </div>
          </>
        )}

        {tab === 'events' && (
          <select
            value={eventType}
            onChange={(e) => setEventType(e.target.value)}
            className="bg-claw-card border border-claw-border rounded-lg px-3 py-1.5 text-sm text-claw-text"
          >
            <option value="">全部事件</option>
            <option value="webhook.received">Webhook Received</option>
            <option value="webhook.processed">Webhook Processed</option>
            <option value="webhook.error">Webhook Error</option>
            <option value="message.queued">Message Queued</option>
            <option value="message.processed">Message Processed</option>
            <option value="session.state">Session State</option>
            <option value="session.stuck">Session Stuck</option>
            <option value="model.usage">Model Usage</option>
            <option value="run.attempt">Run Attempt</option>
            <option value="tool.loop">Tool Loop</option>
          </select>
        )}
      </div>

      {/* Content */}
      {tab === 'logs' && (
        <Card className="!p-0 overflow-hidden">
          {logsLoading ? (
            <div className="p-8"><PageSpinner /></div>
          ) : logs.length === 0 ? (
            <div className="p-8">
              <EmptyState
                title="暂无日志"
                description="请先选择节点并收集日志"
              />
            </div>
          ) : (
            <div className="max-h-[70vh] overflow-y-auto">
              {logs.map((entry) => (
                <LogEntry key={entry.id} log={entry} />
              ))}
            </div>
          )}
        </Card>
      )}

      {tab === 'events' && (
        <Card className="!p-0 overflow-hidden">
          {eventsLoading ? (
            <div className="p-8"><PageSpinner /></div>
          ) : events.length === 0 ? (
            <div className="p-8">
              <EmptyState
                title="暂无诊断事件"
                description="连接 Gateway 后将自动收集诊断事件"
              />
            </div>
          ) : (
            <div className="max-h-[70vh] overflow-y-auto">
              {events.map((event) => (
                <EventEntry key={event.id} event={event} />
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
