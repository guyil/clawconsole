import JSON5 from 'json5';

export interface ParsedOpenClawConfig {
  raw: Record<string, unknown>;
  agents: ParsedAgentEntry[];
  channels: Record<string, unknown>;
  bindings: ParsedBinding[];
  skills: Record<string, unknown>;
  gateway: Record<string, unknown>;
  cron: Record<string, unknown>;
  hooks: Record<string, unknown>;
  models: Record<string, unknown>;
}

export interface ParsedAgentEntry {
  id: string;
  default?: boolean;
  name?: string;
  workspace?: string;
  model?: unknown;
  skills?: string[];
  heartbeat?: unknown;
  identity?: unknown;
  runtime?: unknown;
}

export interface ParsedBinding {
  type?: string;
  agentId: string;
  comment?: string;
  match: {
    channel: string;
    accountId?: string;
    peer?: { kind: string; id: string };
  };
}

export function parseOpenClawJson(content: string): ParsedOpenClawConfig {
  const raw = JSON5.parse(content) as Record<string, unknown>;

  const agentsList = (raw.agents as Record<string, unknown>)?.list as ParsedAgentEntry[] ?? [];
  const channels = (raw.channels ?? {}) as Record<string, unknown>;
  const bindings = (raw.bindings ?? []) as ParsedBinding[];
  const skills = (raw.skills ?? {}) as Record<string, unknown>;
  const gateway = (raw.gateway ?? {}) as Record<string, unknown>;
  const cron = (raw.cron ?? {}) as Record<string, unknown>;
  const hooks = (raw.hooks ?? {}) as Record<string, unknown>;
  const models = (raw.models ?? {}) as Record<string, unknown>;

  return {
    raw,
    agents: agentsList,
    channels,
    bindings,
    skills,
    gateway,
    cron,
    hooks,
    models,
  };
}

export function serializeOpenClawJson(config: Record<string, unknown>): string {
  return JSON.stringify(config, null, 2);
}
