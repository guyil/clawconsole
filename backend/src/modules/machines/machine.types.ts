import type { AgentModelConfig } from '../agents/agent.types.js';

export type MachineStatus = 'online' | 'offline' | 'unknown';

export interface Machine {
  id: string;
  name: string;
  /**
   * Human-readable globally-unique alias used as the prefix in
   * distilled Mini Claw `agent_key`s (e.g. `oc-<alias>-<agentId>`).
   * Backfilled to a slug of `name` for legacy rows by migration 025.
   */
  alias: string | null;
  tailscaleHostname: string;
  tailscaleIp: string | null;
  sshUser: string;
  sshPort: number;
  sshPassword: string | null;
  /**
   * Host port where this machine's openclaw gateway WS/HTTP is reachable
   * (Docker-published per-machine port). When null, falls back to the
   * global default `config.gateway.defaultPort` (18789).
   */
  gatewayPort: number | null;
  /**
   * When true this is a public-IP, Docker-hosted machine: skip the
   * Tailscale ping gate and connect SSH/gateway directly to
   * `tailscaleHostname` (which holds a raw IP). Default false so existing
   * Tailscale machines are unchanged.
   */
  directConnect: boolean;
  /**
   * Shared-secret gateway operator token (openclaw `gateway.auth.token`).
   * Used as the HTTP `Authorization: Bearer` for the admin-http-rpc surface
   * (`POST /api/v1/admin/rpc`) on directConnect machines, since a remote
   * shared-token WebSocket client cannot self-declare operator scopes.
   */
  gatewayToken: string | null;
  /**
   * Per-machine ERP `X_AUTH_TOKEN_AES_KEY`. Used by the console Chat proxy to
   * mint a short-lived X-AUTH-TOKEN (fixed operator identity) when forwarding a
   * chat turn to this machine's gateway `/v1/chat/completions`. Only set on
   * Chat-enabled directConnect machines.
   */
  gatewayAesKey: string | null;
  osInfo: string | null;
  openclawVersion: string | null;
  openclawHome: string;
  status: MachineStatus;
  agentCount: number;
  lastHealthCheckAt: Date | null;
  tags: string[] | null;
  discoveredSkills: string[] | null;
  modelConfig: AgentModelConfig | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateMachineInput {
  name: string;
  alias?: string;
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
  alias?: string;
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
