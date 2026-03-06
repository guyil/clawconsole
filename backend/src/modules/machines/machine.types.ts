export type MachineStatus = 'online' | 'offline' | 'unknown';

export interface Machine {
  id: string;
  name: string;
  tailscaleHostname: string;
  tailscaleIp: string | null;
  sshUser: string;
  sshPort: number;
  sshPassword: string | null;
  osInfo: string | null;
  openclawVersion: string | null;
  openclawHome: string;
  status: MachineStatus;
  agentCount: number;
  lastHealthCheckAt: Date | null;
  tags: string[] | null;
  discoveredSkills: string[] | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateMachineInput {
  name: string;
  tailscaleHostname: string;
  sshUser?: string;
  sshPort?: number;
  sshPassword?: string;
  openclawHome?: string;
  tags?: string[];
}

export interface UpdateMachineInput {
  name?: string;
  sshUser?: string;
  sshPort?: number;
  sshPassword?: string | null;
  openclawHome?: string;
  tags?: string[];
}

export interface MachineHealthCheck {
  status: MachineStatus;
  tailscalePing: { reachable: boolean; latencyMs: number | null };
  sshConnectivity: boolean;
  openclawVersion: string | null;
  gatewayStatus: 'active' | 'inactive' | 'unknown';
  checkedAt: Date;
}

export interface DiscoveredAgent {
  agentId: string;
  workspacePath: string;
  isDefault: boolean;
}

export interface MachineDiscovery {
  agents: DiscoveredAgent[];
  globalSkills: string[];
  cronJobCount: number;
  fileCount: number;
}
