// --- Workflow Status & Enums ---

export type WorkflowStatus = 'draft' | 'active' | 'disabled' | 'archived';

export type TriggerType = 'message' | 'schedule' | 'webhook' | 'manual';

export type NodeType = 'skill' | 'review' | 'condition';

export type ReviewPolicy = 'any' | 'all';

export type EscalationAction = 'notify' | 'auto_approve' | 'auto_reject' | 'abort';

export type NodeErrorAction = 'abort' | 'skip' | 'fallback';

export type WorkflowRunStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'aborted';

export type RunNodeStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'waiting_review';

export type ReviewStatus = 'pending' | 'approved' | 'rejected' | 'escalated' | 'expired';

export type ReviewDecision = 'approved' | 'rejected';

// --- Trigger Config ---

export interface TriggerConfig {
  type: TriggerType;
  channel?: string;
  pattern?: string;
  cron?: string;
}

// --- Node Definitions ---

export interface ReviewerRef {
  userId?: string;
  role?: string;
  group?: string;
}

export interface EscalationConfig {
  action: EscalationAction;
  target: ReviewerRef[];
  message?: string;
}

export interface RetryPolicy {
  maxRetries: number;
  backoff?: 'fixed' | 'exponential';
}

export interface SkillNodeDef {
  id: string;
  type: 'skill';
  name: string;
  skillRef: string;
  input?: Record<string, string>;
  output: string;
  timeout?: string;
  retryPolicy?: RetryPolicy;
  onError?: NodeErrorAction;
}

export interface ReviewNodeDef {
  id: string;
  type: 'review';
  name: string;
  reviewers: ReviewerRef[];
  policy: ReviewPolicy;
  timeout?: string;
  escalation?: EscalationConfig;
  payload?: Record<string, string>;
}

export interface ConditionBranch {
  condition: string;
  target: string;
}

export interface ConditionNodeDef {
  id: string;
  type: 'condition';
  name: string;
  expression: string;
  branches: ConditionBranch[];
  default?: string;
}

export type WorkflowNodeDef = SkillNodeDef | ReviewNodeDef | ConditionNodeDef;

// --- Edge Definition ---

export interface WorkflowEdgeDef {
  source: string;
  target: string;
  condition?: string;
}

// --- Canvas State (React Flow) ---

export interface CanvasNodePosition {
  nodeId: string;
  x: number;
  y: number;
}

export interface CanvasState {
  positions: CanvasNodePosition[];
  zoom?: number;
  panX?: number;
  panY?: number;
}

// --- Workflow Entity ---

export interface Workflow {
  id: string;
  name: string;
  description: string | null;
  machineId: string;
  agentId: string | null;
  status: WorkflowStatus;
  version: string;
  triggerConfig: TriggerConfig;
  nodes: WorkflowNodeDef[];
  edges: WorkflowEdgeDef[];
  variables: Record<string, unknown> | null;
  canvasState: CanvasState | null;
  createdBy: string;
  updatedBy: string | null;
  deployedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateWorkflowInput {
  name: string;
  description?: string;
  machineId: string;
  agentId?: string;
  triggerConfig: TriggerConfig;
  nodes: WorkflowNodeDef[];
  edges: WorkflowEdgeDef[];
  variables?: Record<string, unknown>;
  canvasState?: CanvasState;
  createdBy: string;
}

export interface UpdateWorkflowInput {
  name?: string;
  description?: string;
  status?: WorkflowStatus;
  version?: string;
  triggerConfig?: TriggerConfig;
  nodes?: WorkflowNodeDef[];
  edges?: WorkflowEdgeDef[];
  variables?: Record<string, unknown>;
  canvasState?: CanvasState;
  updatedBy?: string;
  deployedAt?: Date;
}

// --- Workflow Version ---

export interface WorkflowVersion {
  id: string;
  workflowId: string;
  version: string;
  snapshotJson: Record<string, unknown>;
  changeLog: string | null;
  createdBy: string;
  createdAt: Date;
}

export interface CreateVersionInput {
  workflowId: string;
  version: string;
  snapshotJson: Record<string, unknown>;
  changeLog?: string;
  createdBy: string;
}

// --- Workflow Run ---

export interface WorkflowRun {
  id: string;
  workflowId: string;
  runId: string;
  machineId: string;
  status: WorkflowRunStatus;
  triggerInfo: Record<string, unknown> | null;
  currentNodes: string[] | null;
  variables: Record<string, unknown> | null;
  startedAt: Date | null;
  completedAt: Date | null;
  errorMessage: string | null;
  syncedAt: Date;
}

export interface UpsertRunInput {
  workflowId: string;
  runId: string;
  machineId: string;
  status: WorkflowRunStatus;
  triggerInfo?: Record<string, unknown>;
  currentNodes?: string[];
  variables?: Record<string, unknown>;
  startedAt?: Date;
  completedAt?: Date;
  errorMessage?: string;
}

// --- Workflow Run Node ---

export interface WorkflowRunNode {
  id: string;
  runId: string;
  nodeId: string;
  nodeType: NodeType;
  status: RunNodeStatus;
  inputJson: Record<string, unknown> | null;
  outputJson: Record<string, unknown> | null;
  startedAt: Date | null;
  completedAt: Date | null;
  errorMessage: string | null;
}

export interface UpsertRunNodeInput {
  runId: string;
  nodeId: string;
  nodeType: NodeType;
  status: RunNodeStatus;
  inputJson?: Record<string, unknown>;
  outputJson?: Record<string, unknown>;
  startedAt?: Date;
  completedAt?: Date;
  errorMessage?: string;
}

// --- Workflow Review ---

export interface WorkflowReview {
  id: string;
  runId: string;
  nodeId: string;
  status: ReviewStatus;
  reviewers: ReviewerRef[];
  policy: string;
  payload: Record<string, unknown> | null;
  timeoutAt: Date | null;
  decision: ReviewDecision | null;
  decidedBy: string | null;
  comments: string | null;
  decidedAt: Date | null;
  createdAt: Date;
}

export interface CreateReviewInput {
  runId: string;
  nodeId: string;
  reviewers: ReviewerRef[];
  policy: string;
  payload?: Record<string, unknown>;
  timeoutAt?: Date;
}

// --- Validation ---

export interface ValidationError {
  type: string;
  nodeId?: string;
  message: string;
  path?: string[];
}

export interface ValidationWarning {
  type: string;
  nodeId?: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}
