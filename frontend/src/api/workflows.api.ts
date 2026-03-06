import { api } from './client';
import type { PaginatedResponse } from './client';
import type {
  Workflow,
  CreateWorkflowInput,
  UpdateWorkflowInput,
  WorkflowVersion,
  WorkflowRun,
  WorkflowRunNode,
  WorkflowReview,
  ValidationResult,
} from '../types/workflow';

export const workflowsApi = {
  list: (params?: { machineId?: string; agentId?: string; status?: string }) =>
    api.get<PaginatedResponse<Workflow>>('/workflows', { params }).then((r) => r.data),

  get: (id: string) =>
    api.get<Workflow>(`/workflows/${id}`).then((r) => r.data),

  create: (data: CreateWorkflowInput) =>
    api.post<Workflow>('/workflows', data).then((r) => r.data),

  update: (id: string, data: UpdateWorkflowInput) =>
    api.patch<Workflow>(`/workflows/${id}`, data).then((r) => r.data),

  delete: (id: string) =>
    api.delete(`/workflows/${id}`).then((r) => r.data),

  validate: (id: string) =>
    api.post<ValidationResult>(`/workflows/${id}/validate`).then((r) => r.data),

  deploy: (id: string, deployedBy: string) =>
    api.post<Workflow>(`/workflows/${id}/deploy`, { deployedBy }).then((r) => r.data),

  getYaml: (id: string) =>
    api.get<string>(`/workflows/${id}/yaml`, { headers: { Accept: 'text/yaml' } }).then((r) => r.data),

  listVersions: (workflowId: string) =>
    api.get<PaginatedResponse<WorkflowVersion>>(`/workflows/${workflowId}/versions`).then((r) => r.data),

  // --- Runs ---

  listRuns: (workflowId: string, params?: { status?: string }) =>
    api.get<PaginatedResponse<WorkflowRun>>(`/workflows/${workflowId}/runs`, { params }).then((r) => r.data),

  getRun: (runId: string) =>
    api.get<WorkflowRun>(`/workflow-runs/${runId}`).then((r) => r.data),

  getRunNodes: (runId: string) =>
    api.get<PaginatedResponse<WorkflowRunNode>>(`/workflow-runs/${runId}/nodes`).then((r) => r.data),

  abortRun: (runId: string) =>
    api.post(`/workflow-runs/${runId}/abort`).then((r) => r.data),

  // --- Reviews ---

  listPendingReviews: (userId?: string) =>
    api.get<PaginatedResponse<WorkflowReview>>('/reviews/pending', { params: userId ? { userId } : undefined }).then((r) => r.data),

  getReview: (runId: string, nodeId: string) =>
    api.get<WorkflowReview>(`/reviews/${runId}/${nodeId}`).then((r) => r.data),

  submitDecision: (runId: string, nodeId: string, decision: 'approved' | 'rejected', decidedBy: string, comments?: string) =>
    api.post(`/reviews/${runId}/${nodeId}/decide`, { decision, decidedBy, comments }).then((r) => r.data),
};
