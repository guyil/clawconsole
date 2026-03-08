import { api } from './client';
import type { PaginatedResponse } from './client';
import type {
  Workflow,
  CreateWorkflowInput,
  UpdateWorkflowInput,
  WorkflowVersion,
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

  deploy: (id: string, machineId: string, scope?: string, agentId?: string) =>
    api.post<Workflow>(`/workflows/${id}/deploy/${machineId}`, { scope, agentId }).then((r) => r.data),

  getYaml: (id: string) =>
    api.get<string>(`/workflows/${id}/yaml`, { headers: { Accept: 'text/yaml' } }).then((r) => r.data),

  listVersions: (workflowId: string) =>
    api.get<PaginatedResponse<WorkflowVersion>>(`/workflows/${workflowId}/versions`).then((r) => r.data),
};
