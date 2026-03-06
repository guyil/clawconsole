import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { monitoringApi } from '../api/monitoring.api';
import toast from 'react-hot-toast';

export const monitoringKeys = {
  all: ['monitoring'] as const,
  sessions: (params?: Record<string, unknown>) => [...monitoringKeys.all, 'sessions', params] as const,
  sessionDetail: (machineId: string, sessionKey: string) =>
    [...monitoringKeys.all, 'session', machineId, sessionKey] as const,
  transcript: (machineId: string, sessionId: string) =>
    [...monitoringKeys.all, 'transcript', machineId, sessionId] as const,
  logs: (params?: Record<string, unknown>) => [...monitoringKeys.all, 'logs', params] as const,
  events: (params?: Record<string, unknown>) => [...monitoringKeys.all, 'events', params] as const,
  usage: (params?: Record<string, unknown>) => [...monitoringKeys.all, 'usage', params] as const,
  dashboard: (machineId?: string) => [...monitoringKeys.all, 'dashboard', machineId] as const,
};

export function useMonitoringSessions(params?: {
  machineId?: string;
  agentId?: string;
  channel?: string;
  activeMinutes?: number;
  limit?: number;
}) {
  return useQuery({
    queryKey: monitoringKeys.sessions(params as Record<string, unknown>),
    queryFn: () => monitoringApi.listSessions(params),
    refetchInterval: 30_000,
  });
}

export function useSessionTranscript(machineId: string, sessionId: string, agentId?: string) {
  return useQuery({
    queryKey: monitoringKeys.transcript(machineId, sessionId),
    queryFn: () =>
      monitoringApi.getTranscript({ machineId, sessionId, agentId, limit: 500 }),
    enabled: !!machineId && !!sessionId,
  });
}

export function useMonitoringLogs(params?: {
  machineId?: string;
  logSource?: string;
  level?: string;
  query?: string;
  limit?: number;
}) {
  return useQuery({
    queryKey: monitoringKeys.logs(params as Record<string, unknown>),
    queryFn: () => monitoringApi.listLogs(params),
    refetchInterval: 30_000,
  });
}

export function useMonitoringEvents(params?: {
  machineId?: string;
  eventType?: string;
  limit?: number;
}) {
  return useQuery({
    queryKey: monitoringKeys.events(params as Record<string, unknown>),
    queryFn: () => monitoringApi.listEvents(params),
    refetchInterval: 15_000,
  });
}

export function useMonitoringDashboard(machineId?: string) {
  return useQuery({
    queryKey: monitoringKeys.dashboard(machineId),
    queryFn: () => monitoringApi.getDashboard(machineId),
    refetchInterval: 30_000,
  });
}

export function useMonitoringUsage(params?: { machineId?: string; agentId?: string }) {
  return useQuery({
    queryKey: monitoringKeys.usage(params as Record<string, unknown>),
    queryFn: () => monitoringApi.getUsage(params),
  });
}

export function useTriggerSessionSync() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (machineId: string) => monitoringApi.triggerSessionSync(machineId),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: monitoringKeys.all });
      toast.success(`已同步 ${result.synced} 个会话`);
    },
  });
}

export function useTriggerTranscriptPull() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { machineId: string; sessionKey: string; agentId: string }) =>
      monitoringApi.triggerTranscriptPull(params.machineId, params.sessionKey, params.agentId),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: monitoringKeys.all });
      toast.success(`已拉取 ${result.pulled} 条消息`);
    },
  });
}

export function useTriggerLogCollection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (machineId: string) => monitoringApi.triggerLogCollection(machineId),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: monitoringKeys.all });
      const total = result.gateway + result.command + result.configAudit + result.cronRun;
      toast.success(`已收集 ${total} 条日志`);
    },
  });
}
