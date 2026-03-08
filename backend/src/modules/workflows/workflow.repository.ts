import { v4 as uuidv4 } from 'uuid';
import { getDb, type Knex } from '../../shared/db.js';
import type {
  Workflow,
  CreateWorkflowInput,
  UpdateWorkflowInput,
  WorkflowVersion,
  CreateVersionInput,
  WorkflowStatus,
} from './workflow.types.js';

function safeJsonParse<T>(value: unknown): T | null {
  if (!value) return null;
  if (typeof value === 'object') return value as T;
  if (typeof value === 'string') {
    try { return JSON.parse(value) as T; } catch { return null; }
  }
  return null;
}

/**
 * Derive a filesystem-safe key from a workflow name.
 * Lowercases, replaces non-alphanumeric chars with hyphens, deduplicates.
 */
function deriveWorkflowKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    || 'workflow';
}

export class WorkflowRepository {
  private get db(): Knex {
    return getDb();
  }

  // --- Workflows ---

  async findAll(filters?: {
    machineId?: string;
    agentId?: string;
    status?: WorkflowStatus;
  }): Promise<Workflow[]> {
    let query = this.db('workflows').select('*');
    if (filters?.machineId) query = query.where('machine_id', filters.machineId);
    if (filters?.agentId) query = query.where('agent_id', filters.agentId);
    if (filters?.status) query = query.where('status', filters.status);
    const rows = await query.orderBy('updated_at', 'desc');
    return rows.map(this.toWorkflow);
  }

  async findById(id: string): Promise<Workflow | null> {
    const row = await this.db('workflows').where('id', id).first();
    return row ? this.toWorkflow(row) : null;
  }

  async findByName(name: string, machineId: string): Promise<Workflow | null> {
    const row = await this.db('workflows')
      .where({ name, machine_id: machineId })
      .first();
    return row ? this.toWorkflow(row) : null;
  }

  async findByKey(workflowKey: string): Promise<Workflow | null> {
    const row = await this.db('workflows')
      .where('workflow_key', workflowKey)
      .first();
    return row ? this.toWorkflow(row) : null;
  }

  async create(input: CreateWorkflowInput): Promise<Workflow> {
    const id = uuidv4();
    const now = new Date();
    const workflowKey = input.workflowKey || deriveWorkflowKey(input.name);

    await this.db('workflows').insert({
      id,
      name: input.name,
      description: input.description ?? null,
      workflow_key: workflowKey,
      machine_id: input.machineId,
      agent_id: input.agentId ?? null,
      status: 'draft',
      version: '1.0.0',
      trigger_config: JSON.stringify(input.triggerConfig),
      nodes_json: JSON.stringify(input.nodes),
      edges_json: JSON.stringify(input.edges),
      variables_json: input.variables ? JSON.stringify(input.variables) : null,
      canvas_state: input.canvasState ? JSON.stringify(input.canvasState) : null,
      created_by: input.createdBy,
      created_at: now,
      updated_at: now,
    });

    return (await this.findById(id))!;
  }

  async update(id: string, input: UpdateWorkflowInput): Promise<Workflow | null> {
    const updates: Record<string, unknown> = { updated_at: new Date() };
    if (input.name !== undefined) updates.name = input.name;
    if (input.description !== undefined) updates.description = input.description;
    if (input.status !== undefined) updates.status = input.status;
    if (input.version !== undefined) updates.version = input.version;
    if (input.triggerConfig !== undefined) updates.trigger_config = JSON.stringify(input.triggerConfig);
    if (input.nodes !== undefined) updates.nodes_json = JSON.stringify(input.nodes);
    if (input.edges !== undefined) updates.edges_json = JSON.stringify(input.edges);
    if (input.variables !== undefined) updates.variables_json = JSON.stringify(input.variables);
    if (input.canvasState !== undefined) updates.canvas_state = JSON.stringify(input.canvasState);
    if (input.updatedBy !== undefined) updates.updated_by = input.updatedBy;
    if (input.deployedAt !== undefined) updates.deployed_at = input.deployedAt;

    await this.db('workflows').where('id', id).update(updates);
    return this.findById(id);
  }

  async delete(id: string): Promise<boolean> {
    const deleted = await this.db('workflows').where('id', id).delete();
    return deleted > 0;
  }

  // --- Workflow Versions ---

  async findVersions(workflowId: string): Promise<WorkflowVersion[]> {
    const rows = await this.db('workflow_versions')
      .where('workflow_id', workflowId)
      .orderBy('created_at', 'desc');
    return rows.map(this.toVersion);
  }

  async findVersionById(id: string): Promise<WorkflowVersion | null> {
    const row = await this.db('workflow_versions').where('id', id).first();
    return row ? this.toVersion(row) : null;
  }

  async createVersion(input: CreateVersionInput): Promise<WorkflowVersion> {
    const id = uuidv4();
    await this.db('workflow_versions').insert({
      id,
      workflow_id: input.workflowId,
      version: input.version,
      snapshot_json: JSON.stringify(input.snapshotJson),
      change_log: input.changeLog ?? null,
      created_by: input.createdBy,
      created_at: new Date(),
    });
    return (await this.findVersionById(id))!;
  }

  // --- Mappers ---

  private toWorkflow(row: Record<string, unknown>): Workflow {
    return {
      id: row.id as string,
      name: row.name as string,
      description: row.description as string | null,
      workflowKey: (row.workflow_key as string) || '',
      machineId: row.machine_id as string,
      agentId: row.agent_id as string | null,
      status: row.status as WorkflowStatus,
      version: row.version as string,
      triggerConfig: safeJsonParse(row.trigger_config) ?? { type: 'manual' as const },
      nodes: safeJsonParse(row.nodes_json) ?? [],
      edges: safeJsonParse(row.edges_json) ?? [],
      variables: safeJsonParse(row.variables_json),
      canvasState: safeJsonParse(row.canvas_state),
      createdBy: row.created_by as string,
      updatedBy: row.updated_by as string | null,
      deployedAt: row.deployed_at ? new Date(row.deployed_at as string) : null,
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    };
  }

  private toVersion(row: Record<string, unknown>): WorkflowVersion {
    return {
      id: row.id as string,
      workflowId: row.workflow_id as string,
      version: row.version as string,
      snapshotJson: safeJsonParse(row.snapshot_json) ?? {},
      changeLog: row.change_log as string | null,
      createdBy: row.created_by as string,
      createdAt: new Date(row.created_at as string),
    };
  }
}
