// --- Workflow Status & Enums ---

export type WorkflowStatus = 'draft' | 'active' | 'disabled' | 'archived';
export type TriggerType = 'message' | 'schedule' | 'webhook' | 'manual';
export type NodeType = 'skill' | 'review' | 'condition';
export type NodeErrorAction = 'abort' | 'skip' | 'fallback';

// --- Trigger Config ---

export interface TriggerConfig {
  type: TriggerType;
  channel?: string;
  pattern?: string;
  cron?: string;
}

// --- Node Definitions (aligned with Lobster .lobster pipeline steps) ---

export interface RetryPolicy {
  maxRetries: number;
  backoff?: 'fixed' | 'exponential';
}

export interface SkillNodeDef {
  id: string;
  type: 'skill';
  name: string;
  skillRef?: string;
  command: string;
  stdin?: string;
  timeout?: string;
  retryPolicy?: RetryPolicy;
  onError?: NodeErrorAction;
}

export interface ReviewNodeDef {
  id: string;
  type: 'review';
  name: string;
  prompt?: string;
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
  workflowKey: string;
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
  workflowKey?: string;
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
