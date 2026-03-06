import { api } from './client';
import type { PaginatedResponse } from './client';
import type {
  Credential,
  CreateCredentialInput,
  UpdateCredentialInput,
} from '../types/credential';

export const credentialsApi = {
  list: (params?: { machineId?: string; provider?: string }) =>
    api.get<PaginatedResponse<Credential>>('/credentials', { params }).then((r) => r.data),

  get: (id: string) =>
    api.get<Credential>(`/credentials/${id}`).then((r) => r.data),

  create: (data: CreateCredentialInput) =>
    api.post<Credential>('/credentials', data).then((r) => r.data),

  update: (id: string, data: UpdateCredentialInput) =>
    api.patch<Credential>(`/credentials/${id}`, data).then((r) => r.data),

  delete: (id: string) =>
    api.delete(`/credentials/${id}`).then((r) => r.data),

  syncToMachine: (credentialId: string, machineId: string) =>
    api
      .post<{ success: boolean }>(`/credentials/${credentialId}/sync/${machineId}`)
      .then((r) => r.data),

  syncAllToMachine: (machineId: string) =>
    api
      .post<{ synced: number; failed: number }>(
        `/machines/${machineId}/credentials/sync-all`,
      )
      .then((r) => r.data),
};
