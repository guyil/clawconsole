import { v4 as uuidv4 } from 'uuid';
import { getDb, type Knex } from '../../shared/db.js';
import type { AgentModelConfig } from '../agents/agent.types.js';
import type { Machine, CreateMachineInput, UpdateMachineInput, MachineStatus } from './machine.types.js';

export class MachineRepository {
  private get db(): Knex {
    return getDb();
  }

  async findAll(filters?: { status?: MachineStatus; tag?: string }): Promise<Machine[]> {
    const agentCountSub = this.db('agents')
      .count('*')
      .whereRaw('agents.machine_id = machines.id')
      .as('agent_count');

    let query = this.db('machines').select('machines.*', agentCountSub);

    if (filters?.status) {
      query = query.where('status', filters.status);
    }
    if (filters?.tag) {
      query = query.whereRaw('JSON_CONTAINS(tags, ?)', [JSON.stringify(filters.tag)]);
    }

    const rows = await query.orderBy('created_at', 'desc');
    return rows.map(this.toMachine);
  }

  async findById(id: string): Promise<Machine | null> {
    const agentCountSub = this.db('agents')
      .count('*')
      .whereRaw('agents.machine_id = machines.id')
      .as('agent_count');

    const row = await this.db('machines')
      .select('machines.*', agentCountSub)
      .where('machines.id', id)
      .first();
    return row ? this.toMachine(row) : null;
  }

  async findByHostname(hostname: string): Promise<Machine | null> {
    const row = await this.db('machines').where('tailscale_hostname', hostname).first();
    return row ? this.toMachine(row) : null;
  }

  async create(input: CreateMachineInput): Promise<Machine> {
    const id = uuidv4();
    const now = new Date();

    const fallbackAlias = (input.name || `claw-${id.split('-')[0]}`)
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/(^-+|-+$)/g, '')
      .slice(0, 64);

    await this.db('machines').insert({
      id,
      name: input.name,
      alias: input.alias ?? fallbackAlias,
      tailscale_hostname: input.tailscaleHostname,
      ssh_user: input.sshUser ?? 'claw',
      ssh_port: input.sshPort ?? 22,
      ssh_password: input.sshPassword ?? null,
      openclaw_home: input.openclawHome ?? '~/.openclaw',
      gateway_port: input.gatewayPort ?? null,
      direct_connect: input.directConnect ?? false,
      gateway_token: input.gatewayToken ?? null,
      gateway_aes_key: input.gatewayAesKey ?? null,
      tags: input.tags ? JSON.stringify(input.tags) : null,
      status: 'unknown',
      created_at: now,
      updated_at: now,
    });

    return (await this.findById(id))!;
  }

  async update(id: string, input: UpdateMachineInput): Promise<Machine | null> {
    const updates: Record<string, unknown> = { updated_at: new Date() };
    if (input.name !== undefined) updates.name = input.name;
    if (input.alias !== undefined) updates.alias = input.alias;
    if (input.sshUser !== undefined) updates.ssh_user = input.sshUser;
    if (input.sshPort !== undefined) updates.ssh_port = input.sshPort;
    if (input.sshPassword !== undefined) updates.ssh_password = input.sshPassword;
    if (input.openclawHome !== undefined) updates.openclaw_home = input.openclawHome;
    if (input.gatewayPort !== undefined) updates.gateway_port = input.gatewayPort;
    if (input.directConnect !== undefined) updates.direct_connect = input.directConnect;
    if (input.gatewayToken !== undefined) updates.gateway_token = input.gatewayToken;
    if (input.gatewayAesKey !== undefined) updates.gateway_aes_key = input.gatewayAesKey;
    if (input.tags !== undefined) updates.tags = JSON.stringify(input.tags);

    await this.db('machines').where('id', id).update(updates);
    return this.findById(id);
  }

  async updateStatus(
    id: string,
    status: MachineStatus,
    extra?: { tailscaleIp?: string; osInfo?: string; openclawVersion?: string },
  ): Promise<void> {
    const updates: Record<string, unknown> = {
      status,
      last_health_check_at: new Date(),
      updated_at: new Date(),
    };
    if (extra?.tailscaleIp) updates.tailscale_ip = extra.tailscaleIp;
    if (extra?.osInfo) updates.os_info = extra.osInfo;
    if (extra?.openclawVersion) updates.openclaw_version = extra.openclawVersion;

    await this.db('machines').where('id', id).update(updates);
  }

  async updateDiscoveredSkills(id: string, skills: string[]): Promise<void> {
    await this.db('machines').where('id', id).update({
      discovered_skills: JSON.stringify(skills),
      updated_at: new Date(),
    });
  }

  async updateModelConfig(id: string, modelConfig: AgentModelConfig | null): Promise<void> {
    await this.db('machines').where('id', id).update({
      model_config: modelConfig ? JSON.stringify(modelConfig) : null,
      updated_at: new Date(),
    });
  }

  async delete(id: string): Promise<boolean> {
    const deleted = await this.db('machines').where('id', id).delete();
    return deleted > 0;
  }

  private toMachine(row: Record<string, unknown>): Machine {
    const rawModelConfig = row.model_config;
    let modelConfig: AgentModelConfig | null = null;
    if (rawModelConfig) {
      modelConfig = typeof rawModelConfig === 'string'
        ? JSON.parse(rawModelConfig)
        : rawModelConfig as AgentModelConfig;
    }

    return {
      id: row.id as string,
      name: row.name as string,
      alias: (row.alias as string | null) ?? null,
      tailscaleHostname: row.tailscale_hostname as string,
      tailscaleIp: row.tailscale_ip as string | null,
      sshUser: row.ssh_user as string,
      sshPort: row.ssh_port as number,
      sshPassword: (row.ssh_password as string | null) ?? null,
      gatewayPort: (row.gateway_port as number | null) ?? null,
      directConnect: Boolean(row.direct_connect),
      gatewayToken: (row.gateway_token as string | null) ?? null,
      gatewayAesKey: (row.gateway_aes_key as string | null) ?? null,
      osInfo: row.os_info as string | null,
      openclawVersion: row.openclaw_version as string | null,
      openclawHome: row.openclaw_home as string,
      status: row.status as MachineStatus,
      agentCount: Number(row.agent_count ?? 0),
      lastHealthCheckAt: row.last_health_check_at ? new Date(row.last_health_check_at as string) : null,
      tags: row.tags ? JSON.parse(row.tags as string) : null,
      discoveredSkills: row.discovered_skills
        ? (typeof row.discovered_skills === 'string'
          ? JSON.parse(row.discovered_skills)
          : row.discovered_skills as string[])
        : null,
      modelConfig,
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    };
  }
}
