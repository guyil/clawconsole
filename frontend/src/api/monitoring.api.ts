import { api } from './client';
import type { PaginatedResponse } from './client';
import type {
  SessionSnapshot,
  SessionMessage,
  GatewayLog,
  DiagnosticEvent,
  MonitoringDashboard,
  UsageSummary,
} from '../types/monitoring';

export const monitoringApi = {
  // Sessions
  listSessions: (params?: {
    machineId?: string;
    agentId?: string;
    channel?: string;
    activeMinutes?: number;
    limit?: number;
    offset?: number;
  }) =>
    api
      .get<PaginatedResponse<SessionSnapshot>>('/monitoring/sessions', { params })
      .then((r) => r.data),

  getSessionDetail: (machineId: string, sessionKey: string) =>
    api
      .get<SessionSnapshot>('/monitoring/sessions/detail', {
        params: { machineId, sessionKey },
      })
      .then((r) => r.data),

  getTranscript: (params: {
    machineId: string;
    sessionId: string;
    agentId?: string;
    limit?: number;
    offset?: number;
  }) =>
    api
      .get<PaginatedResponse<SessionMessage>>('/monitoring/sessions/transcript', { params })
      .then((r) => r.data),

  // Logs
  listLogs: (params?: {
    machineId?: string;
    logSource?: string;
    level?: string;
    sessionKey?: string;
    agentId?: string;
    since?: string;
    query?: string;
    limit?: number;
    offset?: number;
  }) =>
    api
      .get<PaginatedResponse<GatewayLog>>('/monitoring/logs', { params })
      .then((r) => r.data),

  // Events
  listEvents: (params?: {
    machineId?: string;
    eventType?: string;
    sessionKey?: string;
    since?: string;
    limit?: number;
    offset?: number;
  }) =>
    api
      .get<PaginatedResponse<DiagnosticEvent>>('/monitoring/events', { params })
      .then((r) => r.data),

  // Usage
  getUsage: (params?: { machineId?: string; agentId?: string }) =>
    api
      .get<{ data: UsageSummary[] }>('/monitoring/usage', { params })
      .then((r) => r.data),

  // Dashboard
  getDashboard: (machineId?: string) =>
    api
      .get<MonitoringDashboard>('/monitoring/dashboard', {
        params: machineId ? { machineId } : undefined,
      })
      .then((r) => r.data),

  // Sync triggers
  triggerSessionSync: (machineId: string) =>
    api
      .post<{ synced: number }>('/monitoring/sync/sessions', { machineId })
      .then((r) => r.data),

  triggerTranscriptPull: (machineId: string, sessionKey: string, agentId: string) =>
    api
      .post<{ pulled: number }>('/monitoring/sync/transcript', {
        machineId,
        sessionKey,
        agentId,
      })
      .then((r) => r.data),

  triggerLogCollection: (machineId: string) =>
    api
      .post<{ gateway: number; command: number; configAudit: number; cronRun: number }>(
        '/monitoring/sync/logs',
        { machineId },
      )
      .then((r) => r.data),
};
