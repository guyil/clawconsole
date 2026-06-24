import type { AgentModelConfig } from './agent';

export type MachineStatus = 'online' | 'offline' | 'unknown';

export interface Machine {
  id: string;
  name: string;
  tailscaleHostname: string;
  tailscaleIp: string | null;
  sshUser: string;
  sshPort: number;
  sshPassword: string | null;
  gatewayPort: number | null;
  directConnect: boolean;
  gatewayToken: string | null;
  gatewayAesKey: string | null;
  osInfo: string | null;
  openclawVersion: string | null;
  openclawHome: string;
  status: MachineStatus;
  agentCount?: number;
  lastHealthCheckAt: string | null;
  tags: string[] | null;
  discoveredSkills: string[] | null;
  modelConfig: AgentModelConfig | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateMachineInput {
  name: string;
  tailscaleHostname: string;
  sshUser?: string;
  sshPort?: number;
  sshPassword?: string;
  openclawHome?: string;
  tags?: string[];
  gatewayPort?: number;
  directConnect?: boolean;
  gatewayToken?: string;
  gatewayAesKey?: string;
}

export interface UpdateMachineInput {
  name?: string;
  sshUser?: string;
  sshPort?: number;
  sshPassword?: string | null;
  openclawHome?: string;
  tags?: string[];
  gatewayPort?: number | null;
  directConnect?: boolean;
  gatewayToken?: string | null;
  gatewayAesKey?: string | null;
}

export interface MachineHealthCheck {
  status: MachineStatus;
  tailscalePing: { latencyMs: number } | null;
  sshConnectivity: boolean;
  openclawVersion: string | null;
  gatewayStatus: string;
  checkedAt: string;
}

export interface DiscoveredAgent {
  agentId: string;
  workspacePath: string;
  isDefault: boolean;
}

export interface MachineDiscovery {
  agents: DiscoveredAgent[];
  globalSkills: string[];
  cronJobs: number;
  fileCount: number;
}
