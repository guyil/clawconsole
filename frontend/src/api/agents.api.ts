import { api } from './client';
import type { PaginatedResponse } from './client';
import type { Agent, AgentDetail, AgentWithMachine, AgentConfigFile, AgentModelConfig, AgentModelValue, CreateAgentInput, UpdateAgentInput, ProvisionInput, ProvisionEvent } from '../types/agent';
import type { MemoryFilesResponse } from '../types/memory';

export interface DistillBundle {
  bundleVersion: number;
  generatedAt: string;
  machine: {
    id: string;
    name: string;
    hostname: string;
    openclawHome: string;
    discoveredSkills: string[];
  };
  agent: {
    id: string;
    agentId: string;
    name: string | null;
    description: string | null;
    isDefault: boolean;
    workspacePath: string;
    discoveredSkills: string[];
    modelConfig: AgentModelConfig | null;
    status: string;
    lastSyncedAt: string | null;
  };
  workspace: {
    configFiles: Record<string, string>;
    configFileNames: string[];
  };
  memory: {
    files: Record<string, string>;
    byCategory: {
      core: Array<{ path: string; content: string }>;
      daily: Array<{ path: string; content: string }>;
      sessionSnapshots: Array<{ path: string; content: string }>;
    };
    totalFiles: number;
  };
  skills: Array<{
    install: {
      scope: string;
      enabled: boolean;
      configOverrides: Record<string, unknown> | null;
      installedAt: string;
    };
    skill: {
      skillKey: string;
      name: string;
      description: string | null;
      scope: string;
      source: string;
      version: string | null;
      skillMdContent: string | null;
      auxiliaryFiles: Record<string, string> | null;
      requiresBins: string[] | null;
      requiresEnv: string[] | null;
      tags: string[] | null;
      reviewStatus: string;
    };
  }>;
}

export const agentsApi = {
  listAll: () =>
    api.get<PaginatedResponse<AgentWithMachine>>('/agents').then((r) => r.data),

  listByMachine: (machineId: string) =>
    api.get<PaginatedResponse<Agent>>(`/machines/${machineId}/agents`).then((r) => r.data),

  get: (agentId: string) =>
    api.get<AgentDetail>(`/agents/${agentId}`).then((r) => r.data),

  getConfigFiles: (agentId: string, options?: { refresh?: boolean }) =>
    api
      .get<{ data: AgentConfigFile[] }>(`/agents/${agentId}/config-files`, {
        params: options?.refresh ? { refresh: 'true' } : undefined,
      })
      .then((r) => r.data),

  getMemoryFiles: (agentId: string, options?: { refresh?: boolean }) =>
    api
      .get<MemoryFilesResponse>(`/agents/${agentId}/memory-files`, {
        params: options?.refresh ? { refresh: 'true' } : undefined,
      })
      .then((r) => r.data),

  create: (machineId: string, data: CreateAgentInput) =>
    api.post<Agent>(`/machines/${machineId}/agents`, data).then((r) => r.data),

  update: (agentId: string, data: UpdateAgentInput) =>
    api.patch<Agent>(`/agents/${agentId}`, data).then((r) => r.data),

  delete: (agentId: string, cleanRemote = true) =>
    api.delete(`/agents/${agentId}?cleanRemote=${cleanRemote}`).then((r) => r.data),

  getModelConfig: (agentId: string) =>
    api.get<{ modelConfig: AgentModelConfig | null; agentId: string }>(`/agents/${agentId}/model-config`).then((r) => r.data),

  updateModelConfig: (agentId: string, model: AgentModelValue) =>
    api.put<{ modelConfig: AgentModelConfig }>(`/agents/${agentId}/model-config`, { model }).then((r) => r.data),

  syncModelConfig: (agentId: string) =>
    api.post<{ modelConfig: AgentModelConfig; synced: boolean }>(`/agents/${agentId}/model-config/sync`).then((r) => r.data),

  deleteModelConfig: (agentId: string) =>
    api.delete(`/agents/${agentId}/model-config`).then((r) => r.data),

  /**
   * Fetch a self-contained distillation bundle for this agent.
   *
   * The bundle is the wire format consumed by the platform's
   * `openclaw_distill_service` (yuwen Mini Claw / Agents Hub). Use this
   * to preview what would be sent to the platform when you click
   * "Push to Mini Claw".
   */
  getDistillBundle: (machineId: string, agentId: string) =>
    api
      .get<DistillBundle>(`/machines/${machineId}/agents/${agentId}/distill-bundle`)
      .then((r) => r.data),

  /**
   * Provision an agent via SSE. Consumes the stream and returns
   * a promise that resolves when provisioning is done.
   */
  provision: (agentId: string, data: ProvisionInput): Promise<ProvisionEvent[]> => {
    return new Promise((resolve, reject) => {
      const events: ProvisionEvent[] = [];
      const baseUrl = api.defaults.baseURL ?? '';

      const payload: Record<string, unknown> = {};
      if (data.channels) payload.channels = data.channels;
      if (data.copyFromAgentId) payload.copyFromAgentId = data.copyFromAgentId;

      fetch(`${baseUrl}/agents/${agentId}/provision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
        .then(async (response) => {
          if (!response.ok) {
            const text = await response.text();
            // Try to extract message from JSON error response
            let errorMsg = text || `HTTP ${response.status}`;
            try {
              const parsed = JSON.parse(text);
              if (parsed.message) errorMsg = parsed.message;
            } catch { /* use raw text */ }
            reject(new Error(errorMsg));
            return;
          }

          const reader = response.body?.getReader();
          if (!reader) {
            reject(new Error('No response body'));
            return;
          }

          const decoder = new TextDecoder();
          let buffer = '';
          let rejected = false;

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';

            for (const line of lines) {
              if (rejected) break;
              if (line.startsWith('data: ')) {
                try {
                  const event = JSON.parse(line.slice(6)) as ProvisionEvent;
                  events.push(event);
                  // Reject on any error status (step-level or global)
                  if (event.status === 'error') {
                    rejected = true;
                    reject(new Error(event.message));
                    return;
                  }
                } catch {
                  // skip malformed SSE lines
                }
              }
            }
          }

          if (!rejected) {
            resolve(events);
          }
        })
        .catch((err) => {
          if (!reject) return;
          reject(err);
        });
    });
  },
};
