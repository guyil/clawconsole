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

export interface InsertSummaryInput {
  machineId: string;
  agentId: string;
  agentUuid: string | null;
  periodStartAt: Date;
  periodEndAt: Date;
  sessionCount: number;
  messageCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  model: string | null;
  summaryMarkdown: string | null;
  trigger: SummaryTrigger;
  status: SummaryStatus;
  errorMessage?: string | null;
  feishuPushed?: boolean;
  feishuPushError?: string | null;
}

export interface SummaryFilters {
  machineId?: string;
  agentId?: string;
  agentUuid?: string;
  trigger?: SummaryTrigger;
  status?: SummaryStatus;
  since?: Date;
  until?: Date;
  limit?: number;
  offset?: number;
}

export interface ActiveAgentInfo {
  machineId: string;
  agentId: string;
  messageCount: number;
}

export interface SummaryPushConfigEntry {
  agentUuid: string;
  machineId: string;
  agentId: string;
  agentName: string | null;
  machineName: string;
  enabled: boolean;
}

export interface GenerationTarget {
  machineId: string;
  agentId: string;
  agentUuid: string | null;
  agentName?: string | null;
  machineName?: string;
}

export interface GenerationResult {
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
