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
  canvasState: Record<string, unknown> | null;
  createdBy: string;
  updatedBy: string | null;
  deployedAt: string | null;
  createdAt: string;
  updatedAt: string;
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
  updatedBy?: string;
}

// --- Workflow Version ---

export interface WorkflowVersion {
  id: string;
  workflowId: string;
  version: string;
  snapshotJson: Record<string, unknown>;
  changeLog: string | null;
  createdBy: string;
  createdAt: string;
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
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  syncedAt: string;
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
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
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
  timeoutAt: string | null;
  decision: ReviewDecision | null;
  decidedBy: string | null;
  comments: string | null;
  decidedAt: string | null;
  createdAt: string;
}

// --- Validation ---

export interface WorkflowValidationError {
  type: string;
  nodeId?: string;
  message: string;
  path?: string[];
}

export interface WorkflowValidationWarning {
  type: string;
  nodeId?: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: WorkflowValidationError[];
  warnings: WorkflowValidationWarning[];
}
