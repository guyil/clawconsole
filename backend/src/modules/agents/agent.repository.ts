import { v4 as uuidv4 } from 'uuid';
import { getDb, type Knex } from '../../shared/db.js';
import type { Agent, CreateAgentInput, UpdateAgentInput, AgentStatus } from './agent.types.js';

export class AgentRepository {
  private get db(): Knex {
    return getDb();
  }

  async findAll(): Promise<Array<Agent & { machineName: string; machineHostname: string; machineStatus: string; globalSkills: string[] }>> {
    const rows = await this.db('agents')
      .join('machines', 'agents.machine_id', 'machines.id')
      .select(
        'agents.*',
        'machines.name as machine_name',
        'machines.tailscale_hostname as machine_hostname',
        'machines.status as machine_status',
        'machines.discovered_skills as machine_discovered_skills',
      )
      .orderBy('machines.name', 'asc')
      .orderBy('agents.is_default', 'desc')
      .orderBy('agents.agent_id', 'asc');

    return rows.map((row) => {
      const rawGlobalSkills = row.machine_discovered_skills;
      let globalSkills: string[] = [];
      if (rawGlobalSkills) {
        globalSkills = typeof rawGlobalSkills === 'string'
          ? JSON.parse(rawGlobalSkills)
          : rawGlobalSkills as string[];
      }
      return {
        ...this.toAgent(row),
        machineName: row.machine_name as string,
        machineHostname: row.machine_hostname as string,
        machineStatus: row.machine_status as string,
        globalSkills,
      };
    });
  }

  async findByMachineId(machineId: string): Promise<Agent[]> {
    const rows = await this.db('agents')
      .where('machine_id', machineId)
      .orderBy('is_default', 'desc')
      .orderBy('agent_id', 'asc');
    return rows.map(this.toAgent);
  }

  async findById(id: string): Promise<Agent | null> {
    const row = await this.db('agents').where('id', id).first();
    return row ? this.toAgent(row) : null;
  }

  async findByMachineAndAgentId(machineId: string, agentId: string): Promise<Agent | null> {
    const row = await this.db('agents')
      .where({ machine_id: machineId, agent_id: agentId })
      .first();
    return row ? this.toAgent(row) : null;
  }

  async create(input: CreateAgentInput): Promise<Agent> {
    const id = uuidv4();
    const workspacePath = input.workspacePath ??
      (input.isDefault ? 'workspace' : `workspace-${input.agentId}`);

    await this.db('agents').insert({
      id,
      machine_id: input.machineId,
      agent_id: input.agentId,
      name: input.name ?? null,
      description: input.description ?? null,
      is_default: input.isDefault ?? false,
      workspace_path: workspacePath,
      status: 'draft',
      created_at: new Date(),
      updated_at: new Date(),
    });

    return (await this.findById(id))!;
  }

  async update(id: string, input: UpdateAgentInput): Promise<Agent | null> {
    const updates: Record<string, unknown> = { updated_at: new Date() };
    if (input.name !== undefined) updates.name = input.name;
    if (input.description !== undefined) updates.description = input.description;
    if (input.status !== undefined) updates.status = input.status;

    await this.db('agents').where('id', id).update(updates);
    return this.findById(id);
  }

  async updateSyncTime(id: string): Promise<void> {
    await this.db('agents').where('id', id).update({
      last_synced_at: new Date(),
      updated_at: new Date(),
    });
  }

  async delete(id: string): Promise<boolean> {
    const deleted = await this.db('agents').where('id', id).delete();
    return deleted > 0;
  }

  async upsertFromDiscovery(
    machineId: string,
    agentId: string,
    isDefault: boolean,
    workspacePath: string,
  ): Promise<Agent> {
    const existing = await this.findByMachineAndAgentId(machineId, agentId);
    if (existing) {
      await this.db('agents').where('id', existing.id).update({
        workspace_path: workspacePath,
        is_default: isDefault,
        updated_at: new Date(),
      });
      return (await this.findById(existing.id))!;
    }
    return this.create({ machineId, agentId, isDefault, workspacePath });
  }

  async updateDiscoveredSkills(id: string, skills: string[]): Promise<void> {
    await this.db('agents').where('id', id).update({
      discovered_skills: JSON.stringify(skills),
      updated_at: new Date(),
    });
  }

  private toAgent(row: Record<string, unknown>): Agent {
    const rawSkills = row.discovered_skills;
    let discoveredSkills: string[] | null = null;
    if (rawSkills) {
      discoveredSkills = typeof rawSkills === 'string'
        ? JSON.parse(rawSkills)
        : rawSkills as string[];
    }

    return {
      id: row.id as string,
      machineId: row.machine_id as string,
      agentId: row.agent_id as string,
      name: row.name as string | null,
      description: row.description as string | null,
      isDefault: Boolean(row.is_default),
      workspacePath: row.workspace_path as string | null,
      discoveredSkills,
      status: row.status as AgentStatus,
      lastSyncedAt: row.last_synced_at ? new Date(row.last_synced_at as string) : null,
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    };
  }
}
