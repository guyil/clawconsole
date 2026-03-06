import { v4 as uuidv4 } from 'uuid';
import { getDb, type Knex } from '../../shared/db.js';
import type {
  Workflow,
  CreateWorkflowInput,
  UpdateWorkflowInput,
  WorkflowVersion,
  CreateVersionInput,
  WorkflowRun,
  UpsertRunInput,
  WorkflowRunNode,
  UpsertRunNodeInput,
  WorkflowReview,
  CreateReviewInput,
  WorkflowStatus,
  WorkflowRunStatus,
  ReviewStatus,
  ReviewDecision,
} from './workflow.types.js';

function safeJsonParse<T>(value: unknown): T | null {
  if (!value) return null;
  if (typeof value === 'object') return value as T;
  if (typeof value === 'string') {
    try { return JSON.parse(value) as T; } catch { return null; }
  }
  return null;
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

  async create(input: CreateWorkflowInput): Promise<Workflow> {
    const id = uuidv4();
    const now = new Date();

    await this.db('workflows').insert({
      id,
      name: input.name,
      description: input.description ?? null,
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

  // --- Workflow Runs ---

  async findRuns(filters?: {
    workflowId?: string;
    machineId?: string;
    status?: WorkflowRunStatus;
  }): Promise<WorkflowRun[]> {
    let query = this.db('workflow_runs').select('*');
    if (filters?.workflowId) query = query.where('workflow_id', filters.workflowId);
    if (filters?.machineId) query = query.where('machine_id', filters.machineId);
    if (filters?.status) query = query.where('status', filters.status);
    const rows = await query.orderBy('synced_at', 'desc');
    return rows.map(this.toRun);
  }

  async findRunById(id: string): Promise<WorkflowRun | null> {
    const row = await this.db('workflow_runs').where('id', id).first();
    return row ? this.toRun(row) : null;
  }

  async findRunByRunId(runId: string): Promise<WorkflowRun | null> {
    const row = await this.db('workflow_runs').where('run_id', runId).first();
    return row ? this.toRun(row) : null;
  }

  async upsertRun(input: UpsertRunInput): Promise<WorkflowRun> {
    const existing = await this.findRunByRunId(input.runId);
    if (existing) {
      await this.db('workflow_runs').where('id', existing.id).update({
        status: input.status,
        current_nodes: input.currentNodes ? JSON.stringify(input.currentNodes) : existing.currentNodes,
        variables: input.variables ? JSON.stringify(input.variables) : undefined,
        started_at: input.startedAt ?? undefined,
        completed_at: input.completedAt ?? undefined,
        error_message: input.errorMessage ?? undefined,
        synced_at: new Date(),
      });
      return (await this.findRunById(existing.id))!;
    }

    const id = uuidv4();
    await this.db('workflow_runs').insert({
      id,
      workflow_id: input.workflowId,
      run_id: input.runId,
      machine_id: input.machineId,
      status: input.status,
      trigger_info: input.triggerInfo ? JSON.stringify(input.triggerInfo) : null,
      current_nodes: input.currentNodes ? JSON.stringify(input.currentNodes) : null,
      variables: input.variables ? JSON.stringify(input.variables) : null,
      started_at: input.startedAt ?? null,
      completed_at: input.completedAt ?? null,
      error_message: input.errorMessage ?? null,
      synced_at: new Date(),
    });
    return (await this.findRunById(id))!;
  }

  async updateRunStatus(id: string, status: WorkflowRunStatus, errorMessage?: string): Promise<WorkflowRun | null> {
    const updates: Record<string, unknown> = { status, synced_at: new Date() };
    if (status === 'completed' || status === 'failed' || status === 'aborted') {
      updates.completed_at = new Date();
    }
    if (errorMessage !== undefined) updates.error_message = errorMessage;

    await this.db('workflow_runs').where('id', id).update(updates);
    return this.findRunById(id);
  }

  // --- Workflow Run Nodes ---

  async findRunNodes(runId: string): Promise<WorkflowRunNode[]> {
    const rows = await this.db('workflow_run_nodes').where('run_id', runId);
    return rows.map(this.toRunNode);
  }

  async upsertRunNode(input: UpsertRunNodeInput): Promise<WorkflowRunNode> {
    const existing = await this.db('workflow_run_nodes')
      .where({ run_id: input.runId, node_id: input.nodeId })
      .first();

    if (existing) {
      await this.db('workflow_run_nodes').where('id', existing.id as string).update({
        status: input.status,
        input_json: input.inputJson ? JSON.stringify(input.inputJson) : undefined,
        output_json: input.outputJson ? JSON.stringify(input.outputJson) : undefined,
        started_at: input.startedAt ?? undefined,
        completed_at: input.completedAt ?? undefined,
        error_message: input.errorMessage ?? undefined,
      });
      const row = await this.db('workflow_run_nodes').where('id', existing.id as string).first();
      return this.toRunNode(row!);
    }

    const id = uuidv4();
    await this.db('workflow_run_nodes').insert({
      id,
      run_id: input.runId,
      node_id: input.nodeId,
      node_type: input.nodeType,
      status: input.status,
      input_json: input.inputJson ? JSON.stringify(input.inputJson) : null,
      output_json: input.outputJson ? JSON.stringify(input.outputJson) : null,
      started_at: input.startedAt ?? null,
      completed_at: input.completedAt ?? null,
      error_message: input.errorMessage ?? null,
    });
    const row = await this.db('workflow_run_nodes').where('id', id).first();
    return this.toRunNode(row!);
  }

  // --- Reviews ---

  async findPendingReviews(decidedBy?: string): Promise<WorkflowReview[]> {
    let query = this.db('workflow_reviews').where('status', 'pending');
    if (decidedBy) {
      // Filter by reviewers containing the user (JSON search)
      query = query.whereRaw("JSON_SEARCH(reviewers, 'one', ?) IS NOT NULL", [decidedBy]);
    }
    const rows = await query.orderBy('created_at', 'asc');
    return rows.map(this.toReview);
  }

  async findReviewByRunAndNode(runId: string, nodeId: string): Promise<WorkflowReview | null> {
    const row = await this.db('workflow_reviews')
      .where({ run_id: runId, node_id: nodeId })
      .first();
    return row ? this.toReview(row) : null;
  }

  async findReviewById(id: string): Promise<WorkflowReview | null> {
    const row = await this.db('workflow_reviews').where('id', id).first();
    return row ? this.toReview(row) : null;
  }

  async createReview(input: CreateReviewInput): Promise<WorkflowReview> {
    const id = uuidv4();
    await this.db('workflow_reviews').insert({
      id,
      run_id: input.runId,
      node_id: input.nodeId,
      status: 'pending',
      reviewers: JSON.stringify(input.reviewers),
      policy: input.policy,
      payload: input.payload ? JSON.stringify(input.payload) : null,
      timeout_at: input.timeoutAt ?? null,
      created_at: new Date(),
    });
    return (await this.findReviewById(id))!;
  }

  async updateReviewDecision(
    id: string,
    decision: ReviewDecision,
    decidedBy: string,
    comments?: string,
  ): Promise<WorkflowReview | null> {
    const status: ReviewStatus = decision;
    await this.db('workflow_reviews').where('id', id).update({
      status,
      decision,
      decided_by: decidedBy,
      comments: comments ?? null,
      decided_at: new Date(),
    });
    return this.findReviewById(id);
  }

  async updateReviewStatus(id: string, status: ReviewStatus): Promise<WorkflowReview | null> {
    await this.db('workflow_reviews').where('id', id).update({ status });
    return this.findReviewById(id);
  }

  async findExpiredReviews(): Promise<WorkflowReview[]> {
    const rows = await this.db('workflow_reviews')
      .where('status', 'pending')
      .whereNotNull('timeout_at')
      .where('timeout_at', '<', new Date());
    return rows.map(this.toReview);
  }

  // --- Mappers ---

  private toWorkflow(row: Record<string, unknown>): Workflow {
    return {
      id: row.id as string,
      name: row.name as string,
      description: row.description as string | null,
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

  private toRun(row: Record<string, unknown>): WorkflowRun {
    return {
      id: row.id as string,
      workflowId: row.workflow_id as string,
      runId: row.run_id as string,
      machineId: row.machine_id as string,
      status: row.status as WorkflowRunStatus,
      triggerInfo: safeJsonParse(row.trigger_info),
      currentNodes: safeJsonParse(row.current_nodes),
      variables: safeJsonParse(row.variables),
      startedAt: row.started_at ? new Date(row.started_at as string) : null,
      completedAt: row.completed_at ? new Date(row.completed_at as string) : null,
      errorMessage: row.error_message as string | null,
      syncedAt: new Date(row.synced_at as string),
    };
  }

  private toRunNode(row: Record<string, unknown>): WorkflowRunNode {
    return {
      id: row.id as string,
      runId: row.run_id as string,
      nodeId: row.node_id as string,
      nodeType: row.node_type as 'skill' | 'review' | 'condition',
      status: row.status as RunNodeStatus,
      inputJson: safeJsonParse(row.input_json),
      outputJson: safeJsonParse(row.output_json),
      startedAt: row.started_at ? new Date(row.started_at as string) : null,
      completedAt: row.completed_at ? new Date(row.completed_at as string) : null,
      errorMessage: row.error_message as string | null,
    };
  }

  private toReview(row: Record<string, unknown>): WorkflowReview {
    return {
      id: row.id as string,
      runId: row.run_id as string,
      nodeId: row.node_id as string,
      status: row.status as ReviewStatus,
      reviewers: safeJsonParse(row.reviewers) ?? [],
      policy: row.policy as string,
      payload: safeJsonParse(row.payload),
      timeoutAt: row.timeout_at ? new Date(row.timeout_at as string) : null,
      decision: row.decision as ReviewDecision | null,
      decidedBy: row.decided_by as string | null,
      comments: row.comments as string | null,
      decidedAt: row.decided_at ? new Date(row.decided_at as string) : null,
      createdAt: new Date(row.created_at as string),
    };
  }
}
