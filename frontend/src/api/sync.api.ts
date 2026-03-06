import { api } from './client';
import type { PaginatedResponse } from './client';
import type {
  SyncOperation,
  PullResult,
  PushResult,
  SyncPlan,
  PushInput,
} from '../types/sync';

export const syncApi = {
  pull: (machineId: string) =>
    api.post<PullResult>(`/machines/${machineId}/sync/pull`).then((r) => r.data),

  plan: (machineId: string) =>
    api.get<SyncPlan>(`/machines/${machineId}/sync/plan`).then((r) => r.data),

  push: (machineId: string, data?: PushInput) =>
    api.post<PushResult>(`/machines/${machineId}/sync/push`, data).then((r) => r.data),

  fullSync: (machineId: string) =>
    api.post(`/machines/${machineId}/sync/full`).then((r) => r.data),

  listOperations: (machineId: string, params?: { status?: string; page?: number; pageSize?: number }) =>
    api
      .get<PaginatedResponse<SyncOperation>>(`/machines/${machineId}/sync/operations`, { params })
      .then((r) => r.data),

  getOperation: (operationId: string) =>
    api.get<SyncOperation>(`/sync/operations/${operationId}`).then((r) => r.data),

  retryOperation: (operationId: string) =>
    api.post(`/sync/operations/${operationId}/retry`).then((r) => r.data),

  batchSync: (machineIds: string[], direction: 'push' | 'pull') =>
    api.post('/sync/batch', { machineIds, direction }).then((r) => r.data),
};
