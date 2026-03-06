// --- Session Snapshot ---

export interface SessionSnapshot {
  id: number;
  machineId: string;
  agentId: string;
  sessionKey: string;
  sessionId: string | null;
  channel: string | null;
  chatType: string | null;
  originFrom: string | null;
  originTo: string | null;
  originProvider: string | null;
  originSurface: string | null;
  modelProvider: string | null;
  model: string | null;
  thinkingLevel: string | null;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheRead: number;
  cacheWrite: number;
  label: string | null;
  displayName: string | null;
  sendPolicy: string | null;
  compactionCount: number;
  lastActivityAt: string | null;
  snapshotAt: string;
}

export interface UpsertSessionSnapshotInput {
  machineId: string;
  agentId: string;
  sessionKey: string;
  sessionId?: string | null;
  channel?: string | null;
  chatType?: string | null;
  originFrom?: string | null;
  originTo?: string | null;
  originProvider?: string | null;
  originSurface?: string | null;
  modelProvider?: string | null;
  model?: string | null;
  thinkingLevel?: string | null;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cacheRead?: number;
  cacheWrite?: number;
  label?: string | null;
  displayName?: string | null;
  sendPolicy?: string | null;
  compactionCount?: number;
  lastActivityAt?: string | null;
}

// --- Session Message ---

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool' | 'other';

export interface SessionMessage {
  id: number;
  machineId: string;
  agentId: string;
  sessionId: string;
  messageIndex: number;
  role: MessageRole;
  content: string | null;
  provider: string | null;
  model: string | null;
  api: string | null;
  stopReason: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  totalTokens: number | null;
  costUsd: number | null;
  messageTimestamp: number | null;
  collectedAt: string;
}

export interface InsertSessionMessageInput {
  machineId: string;
  agentId: string;
  sessionId: string;
  messageIndex: number;
  role: MessageRole;
  content?: string | null;
  provider?: string | null;
  model?: string | null;
  api?: string | null;
  stopReason?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  cacheReadTokens?: number | null;
  cacheWriteTokens?: number | null;
  totalTokens?: number | null;
  costUsd?: number | null;
  messageTimestamp?: number | null;
}

// --- Gateway Log ---

export type LogSource = 'gateway' | 'command' | 'config_audit' | 'cron_run';

export interface GatewayLog {
  id: number;
  machineId: string;
  logSource: LogSource;
  level: string | null;
  subsystem: string | null;
  message: string | null;
  sessionKey: string | null;
  sessionId: string | null;
  agentId: string | null;
  channel: string | null;
  extraData: Record<string, unknown> | null;
  loggedAt: string;
  collectedAt: string;
}

export interface InsertGatewayLogInput {
  machineId: string;
  logSource: LogSource;
  level?: string | null;
  subsystem?: string | null;
  message?: string | null;
  sessionKey?: string | null;
  sessionId?: string | null;
  agentId?: string | null;
  channel?: string | null;
  extraData?: Record<string, unknown> | null;
  loggedAt: string;
}

// --- Diagnostic Event ---

export interface DiagnosticEvent {
  id: number;
  machineId: string;
  eventType: string;
  sessionKey: string | null;
  sessionId: string | null;
  channel: string | null;
  provider: string | null;
  model: string | null;
  durationMs: number | null;
  outcome: string | null;
  errorMessage: string | null;
  tokenUsage: Record<string, unknown> | null;
  extraData: Record<string, unknown> | null;
  eventAt: string;
  collectedAt: string;
}

export interface InsertDiagnosticEventInput {
  machineId: string;
  eventType: string;
  sessionKey?: string | null;
  sessionId?: string | null;
  channel?: string | null;
  provider?: string | null;
  model?: string | null;
  durationMs?: number | null;
  outcome?: string | null;
  errorMessage?: string | null;
  tokenUsage?: Record<string, unknown> | null;
  extraData?: Record<string, unknown> | null;
  eventAt: string;
}

// --- Query filters ---

export interface SessionSnapshotFilters {
  machineId?: string;
  agentId?: string;
  channel?: string;
  activeMinutes?: number;
  limit?: number;
  offset?: number;
}

export interface SessionMessageFilters {
  machineId: string;
  sessionId: string;
  agentId?: string;
  limit?: number;
  offset?: number;
}

export interface GatewayLogFilters {
  machineId?: string;
  logSource?: LogSource;
  level?: string;
  sessionKey?: string;
  agentId?: string;
  since?: string;
  query?: string;
  limit?: number;
  offset?: number;
}

export interface DiagnosticEventFilters {
  machineId?: string;
  eventType?: string;
  sessionKey?: string;
  since?: string;
  limit?: number;
  offset?: number;
}

// --- Dashboard ---

export interface MonitoringDashboard {
  totalSessions: number;
  activeSessions: number;
  totalTokens: number;
  errorCount: number;
  agentSummaries: AgentUsageSummary[];
  recentEvents: DiagnosticEvent[];
}

export interface AgentUsageSummary {
  agentId: string;
  machineId: string;
  sessionCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  lastActivityAt: string | null;
}

export interface UsageSummary {
  agentId: string;
  machineId: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalCacheRead: number;
  totalCacheWrite: number;
  sessionCount: number;
}
