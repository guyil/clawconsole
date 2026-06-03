import { v4 as uuidv4 } from 'uuid';
import { getDb, type Knex } from '../../shared/db.js';
import type {
  Agent,
  AgentModelConfig,
  CreateAgentInput,
  UpdateAgentInput,
  AgentStatus,
  OssSyncStatus,
} from './agent.types.js';

/** Cap stored error messages so a runaway stack trace can't bloat the
 *  agents row (and the JSON the BotsPage downloads). 500 chars is plenty
 *  to identify the failure class while keeping the UI tooltip readable. */
const OSS_SYNC_ERROR_MAX_LEN = 500;

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
    if (input.modelConfig !== undefined) {
      updates.model_config = input.modelConfig ? JSON.stringify(input.modelConfig) : null;
    }
    if (input.ossSyncEnabled !== undefined) {
      updates.oss_sync_enabled = input.ossSyncEnabled;
    }

    await this.db('agents').where('id', id).update(updates);
    return this.findById(id);
  }

  async updateModelConfig(id: string, modelConfig: AgentModelConfig | null): Promise<void> {
    await this.db('agents').where('id', id).update({
      model_config: modelConfig ? JSON.stringify(modelConfig) : null,
      updated_at: new Date(),
    });
  }

  async updateSyncTime(id: string): Promise<void> {
    await this.db('agents').where('id', id).update({
      last_synced_at: new Date(),
      updated_at: new Date(),
    });
  }

  /**
   * Persist the result of an OSS distill push attempt so the status API
   * and BotsPage can render freshness without scraping logs.
   *
   * On success: stamps ``last_oss_sync_at`` + ``last_oss_vector_sha`` +
   *   ``last_oss_duration_ms`` and CLEARS the prior error (so a once-stuck
   *   agent doesn't keep showing red after it recovers).
   * On failure: stamps ``last_oss_sync_at`` + ``last_oss_sync_error``
   *   (truncated). We deliberately do NOT clear ``last_oss_vector_sha``
   *   on failure — the most recent good vector is still on OSS, and
   *   showing it lets ops compare "what mini-claw is serving" against
   *   "what we last managed to ship".
   *
   * Note we don't bump ``updated_at`` here. Bumping it on every daily
   * cron tick would invalidate every other "what changed today?" query
   * the UI / dashboards do (sync status, model config, etc.) — and
   * nothing about an OSS push corresponds to a user-visible change to
   * the agent's identity. The per-OSS timestamp lives in its own column.
   */
  async recordOssSync(
    id: string,
    result:
      | {
          status: 'ok';
          syncedAt: Date;
          vectorSha: string | null;
          durationMs: number;
        }
      | {
          status: 'failed';
          syncedAt: Date;
          error: string;
          durationMs: number;
        },
  ): Promise<void> {
    const updates: Record<string, unknown> = {
      last_oss_sync_at: result.syncedAt,
      last_oss_sync_status: result.status,
      last_oss_duration_ms: result.durationMs,
    };
    if (result.status === 'ok') {
      updates.last_oss_sync_error = null;
      if (result.vectorSha) updates.last_oss_vector_sha = result.vectorSha;
    } else {
      updates.last_oss_sync_error = (result.error ?? '').slice(0, OSS_SYNC_ERROR_MAX_LEN);
    }
    await this.db('agents').where('id', id).update(updates);
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

    const rawModelConfig = row.model_config;
    let modelConfig: AgentModelConfig | null = null;
    if (rawModelConfig) {
      modelConfig = typeof rawModelConfig === 'string'
        ? JSON.parse(rawModelConfig)
        : rawModelConfig as AgentModelConfig;
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
      modelConfig,
      status: row.status as AgentStatus,
      lastSyncedAt: row.last_synced_at ? new Date(row.last_synced_at as string) : null,
      // Default to ``true`` defensively: pre-migration rows or DBs whose
      // schema cache hasn't refreshed will return ``undefined`` here, and
      // we'd rather treat such bots as opted-in (matches the pre-feature
      // behaviour) than silently drop them from the nightly cron.
      ossSyncEnabled:
        row.oss_sync_enabled === undefined || row.oss_sync_enabled === null
          ? true
          : Boolean(row.oss_sync_enabled),
      lastOssSyncAt: row.last_oss_sync_at ? new Date(row.last_oss_sync_at as string) : null,
      lastOssSyncStatus: (row.last_oss_sync_status as OssSyncStatus | null) ?? null,
      lastOssSyncError: (row.last_oss_sync_error as string | null) ?? null,
      lastOssVectorSha: (row.last_oss_vector_sha as string | null) ?? null,
      lastOssDurationMs:
        row.last_oss_duration_ms !== null && row.last_oss_duration_ms !== undefined
          ? Number(row.last_oss_duration_ms)
          : null,
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    };
  }
}
