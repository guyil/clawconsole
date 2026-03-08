import { api } from './client';
import type { PaginatedResponse } from './client';
import type { Agent, AgentDetail, AgentWithMachine, AgentConfigFile, CreateAgentInput, UpdateAgentInput, ProvisionInput, ProvisionEvent } from '../types/agent';
import type { MemoryFilesResponse } from '../types/memory';

export const agentsApi = {
  listAll: () =>
    api.get<PaginatedResponse<AgentWithMachine>>('/agents').then((r) => r.data),

  listByMachine: (machineId: string) =>
    api.get<PaginatedResponse<Agent>>(`/machines/${machineId}/agents`).then((r) => r.data),

  get: (agentId: string) =>
    api.get<AgentDetail>(`/agents/${agentId}`).then((r) => r.data),

  getConfigFiles: (agentId: string) =>
    api.get<{ data: AgentConfigFile[] }>(`/agents/${agentId}/config-files`).then((r) => r.data),

  getMemoryFiles: (agentId: string) =>
    api.get<MemoryFilesResponse>(`/agents/${agentId}/memory-files`).then((r) => r.data),

  create: (machineId: string, data: CreateAgentInput) =>
    api.post<Agent>(`/machines/${machineId}/agents`, data).then((r) => r.data),

  update: (agentId: string, data: UpdateAgentInput) =>
    api.patch<Agent>(`/agents/${agentId}`, data).then((r) => r.data),

  /**
   * Provision an agent via SSE. Consumes the stream and returns
   * a promise that resolves when provisioning is done.
   */
  provision: (agentId: string, data: ProvisionInput): Promise<ProvisionEvent[]> => {
    return new Promise((resolve, reject) => {
      const events: ProvisionEvent[] = [];
      const baseUrl = api.defaults.baseURL ?? '';

      fetch(`${baseUrl}/agents/${agentId}/provision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
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
