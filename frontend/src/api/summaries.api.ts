import { api } from './client';

export type SummaryTrigger = 'scheduled' | 'manual';
export type SummaryStatus = 'success' | 'empty' | 'failed';

export interface SessionSummary {
  id: number;
  machineId: string;
  agentId: string;
  agentUuid: string | null;
  periodStartAt: string;
  periodEndAt: string;
  sessionCount: number;
  messageCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  model: string | null;
  summaryMarkdown: string | null;
  trigger: SummaryTrigger;
  status: SummaryStatus;
  errorMessage: string | null;
  feishuPushed: boolean;
  feishuPushError: string | null;
  createdAt: string;
}

export interface SummariesListResponse {
  data: SessionSummary[];
  total: number;
}

export interface SummaryStatusInfo {
  geminiConfigured: boolean;
  feishuConfigured: boolean;
  feishuHint: string | null;
  model: string;
  windowHours: number;
}

export interface SummaryPushConfigEntry {
  agentUuid: string;
  machineId: string;
  agentId: string;
  agentName: string | null;
  machineName: string;
  enabled: boolean;
}

export interface SummaryListParams {
  machineId?: string;
  agentId?: string;
  agentUuid?: string;
  trigger?: SummaryTrigger;
  status?: SummaryStatus;
  since?: string;
  until?: string;
  limit?: number;
  offset?: number;
}

export interface GenerateSummaryPayload {
  agentUuids?: string[];
  machineId?: string;
  agentId?: string;
  days: number;
  forcePush?: boolean;
}

export interface GenerateSummaryResult {
  machineId: string;
  agentId: string;
  agentUuid: string | null;
  summaryId: number | null;
  status: SummaryStatus;
  pushed: boolean;
  pushError: string | null;
  errorMessage: string | null;
  sessionCount: number;
  messageCount: number;
}

export const summariesApi = {
  status: () =>
    api.get<SummaryStatusInfo>('/summaries/status').then((r) => r.data),

  list: (params?: SummaryListParams) =>
    api
      .get<SummariesListResponse>('/summaries', { params })
      .then((r) => r.data),

  get: (id: number) =>
    api.get<SessionSummary>(`/summaries/${id}`).then((r) => r.data),

  listPushConfig: () =>
    api
      .get<{ data: SummaryPushConfigEntry[] }>('/summaries/push-config')
      .then((r) => r.data.data),

  setPushEnabled: (agentUuid: string, enabled: boolean) =>
    api
      .put<{ ok: true; enabled: boolean }>(
        `/summaries/push-config/${agentUuid}`,
        { enabled },
      )
      .then((r) => r.data),

  generate: (payload: GenerateSummaryPayload) =>
    api
      .post<{ results: GenerateSummaryResult[] }>('/summaries/generate', payload)
      .then((r) => r.data),
};
