import { api } from './client';
import type { PaginatedResponse } from './client';
import type { Agent, AgentDetail, AgentWithMachine, AgentConfigFile, CreateAgentInput, UpdateAgentInput } from '../types/agent';

export const agentsApi = {
  listAll: () =>
    api.get<PaginatedResponse<AgentWithMachine>>('/agents').then((r) => r.data),

  listByMachine: (machineId: string) =>
    api.get<PaginatedResponse<Agent>>(`/machines/${machineId}/agents`).then((r) => r.data),

  get: (agentId: string) =>
    api.get<AgentDetail>(`/agents/${agentId}`).then((r) => r.data),

  getConfigFiles: (agentId: string) =>
    api.get<{ data: AgentConfigFile[] }>(`/agents/${agentId}/config-files`).then((r) => r.data),

  create: (machineId: string, data: CreateAgentInput) =>
    api.post<Agent>(`/machines/${machineId}/agents`, data).then((r) => r.data),

  update: (agentId: string, data: UpdateAgentInput) =>
    api.patch<Agent>(`/agents/${agentId}`, data).then((r) => r.data),
};
