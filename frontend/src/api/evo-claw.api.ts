import { api } from './client';

export interface EvoRun {
  id: number;
  machineId: string;
  agentId: string;
  triggerType: 'scheduled' | 'manual' | 'skill';
  status: string;
  sessionsAnalyzed: number;
  signalsFound: number;
  rulesGenerated: number;
  casesGenerated: number;
  summary: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface EvoSignal {
  id: number;
  signalType: 'evaluative' | 'instructive';
  polarity: 'positive' | 'negative' | 'neutral' | null;
  sourceSessionId: string;
  rawContent: string;
  hint: string | null;
  classificationReason: string | null;
}

export interface EvoRule {
  id: number;
  machineId: string;
  agentId: string;
  ruleKey: string;
  ruleType: 'constraint' | 'preference' | 'procedure';
  content: string;
  targetFile: string;
  targetSection: string | null;
  status: 'active' | 'deprecated' | 'merged' | 'superseded';
  confidenceScore: number;
  triggerCount: number;
  positiveFeedbackCount: number;
  negativeFeedbackCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface EvoCase {
  id: number;
  machineId: string;
  agentId: string;
  caseKey: string;
  scenario: string;
  userQuestionSummary: string;
  botWrongAnswerSummary: string;
  userCorrection: string;
  correctApproach: string;
  status: 'active' | 'deprecated' | 'merged';
  relevanceCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface EvoRunDetail extends EvoRun {
  signals: EvoSignal[];
}

export const evoClawApi = {
  triggerEvolution: (agentId: string, machineId: string) =>
    api.post<EvoRun>(`/agents/${agentId}/evo/trigger`, { machineId }).then((r) => r.data),

  listRuns: (agentId: string, params?: { machineId?: string; limit?: number }) =>
    api.get<EvoRun[]>(`/agents/${agentId}/evo/runs`, { params }).then((r) => r.data),

  getRunDetail: (agentId: string, runId: number) =>
    api.get<EvoRunDetail>(`/agents/${agentId}/evo/runs/${runId}`).then((r) => r.data),

  listRules: (agentId: string, params?: { machineId?: string; status?: string; targetFile?: string }) =>
    api.get<EvoRule[]>(`/agents/${agentId}/evo/rules`, { params }).then((r) => r.data),

  updateRule: (agentId: string, ruleId: number, data: { content?: string; status?: string }) =>
    api.patch(`/agents/${agentId}/evo/rules/${ruleId}`, data).then((r) => r.data),

  deleteRule: (agentId: string, ruleId: number) =>
    api.delete(`/agents/${agentId}/evo/rules/${ruleId}`).then((r) => r.data),

  listCases: (agentId: string, params?: { machineId?: string; status?: string }) =>
    api.get<EvoCase[]>(`/agents/${agentId}/evo/cases`, { params }).then((r) => r.data),

  updateCase: (agentId: string, caseId: number, data: { correctApproach?: string; status?: string }) =>
    api.patch(`/agents/${agentId}/evo/cases/${caseId}`, data).then((r) => r.data),

  deleteCase: (agentId: string, caseId: number) =>
    api.delete(`/agents/${agentId}/evo/cases/${caseId}`).then((r) => r.data),
};
