import { api } from './client';
import type { AgentModelConfig, AgentModelValue } from '../types/agent';

export interface RemoteModelInfo {
  globalDefault: AgentModelValue | null;
  agentOverrides: Array<{ agentId: string; model: AgentModelValue }>;
}

export const modelConfigApi = {
  getMachineModelConfig: (machineId: string) =>
    api.get<{ modelConfig: AgentModelConfig | null }>(`/machines/${machineId}/model-config`).then((r) => r.data),

  getRemoteModelConfig: (machineId: string) =>
    api.get<RemoteModelInfo>(`/machines/${machineId}/model-config/remote`).then((r) => r.data),

  updateMachineModelConfig: (machineId: string, model: AgentModelValue) =>
    api.put<{ modelConfig: AgentModelConfig }>(`/machines/${machineId}/model-config`, { model }).then((r) => r.data),

  syncMachineModelConfig: (machineId: string) =>
    api.post<{ modelConfig: AgentModelConfig; synced: boolean }>(`/machines/${machineId}/model-config/sync`).then((r) => r.data),
};
