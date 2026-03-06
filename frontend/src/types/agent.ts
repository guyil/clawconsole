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
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAgentInput {
  agentId: string;
  name?: string;
  description?: string;
  isDefault?: boolean;
}

export interface UpdateAgentInput {
  name?: string;
  description?: string;
  status?: AgentStatus;
}

export interface AgentWithMachine extends Agent {
  machineName: string;
  machineHostname: string;
  machineStatus: string;
  globalSkills: string[];
}

export interface AgentDetail extends Agent {
  globalSkills: string[];
}

export interface AgentConfigFile {
  filename: string;
  content: string;
}
