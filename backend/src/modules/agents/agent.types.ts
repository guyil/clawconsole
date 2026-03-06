export type AgentStatus = 'draft' | 'packaging' | 'syncing' | 'online' | 'degraded' | 'offline' | 'archived';

export interface Agent {
  id: string;
  machineId: string;
  agentId: string;
  name: string | null;
  description: string | null;
  isDefault: boolean;
  workspacePath: string | null;
  discoveredSkills: string[] | null;
  status: AgentStatus;
  lastSyncedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateAgentInput {
  machineId: string;
  agentId: string;
  name?: string;
  description?: string;
  isDefault?: boolean;
  workspacePath?: string;
}

export interface UpdateAgentInput {
  name?: string;
  description?: string;
  status?: AgentStatus;
}
