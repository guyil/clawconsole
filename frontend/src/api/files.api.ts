import { api } from './client';
import type { PaginatedResponse } from './client';
import type { ManagedFile, FileListFilters } from '../types/file';

export const filesApi = {
  listByMachine: (machineId: string, filters?: FileListFilters) =>
    api
      .get<PaginatedResponse<ManagedFile>>(`/machines/${machineId}/files`, { params: filters })
      .then((r) => r.data),

  listByAgent: (agentId: string) =>
    api.get<PaginatedResponse<ManagedFile>>(`/agents/${agentId}/files`).then((r) => r.data),

  get: (fileId: string) =>
    api.get<ManagedFile>(`/files/${fileId}`).then((r) => r.data),

  update: (fileId: string, content: string) =>
    api.put<ManagedFile>(`/files/${fileId}`, { content }).then((r) => r.data),

  getByPath: (machineId: string, path: string) =>
    api
      .get<ManagedFile>(`/machines/${machineId}/files/by-path`, { params: { path } })
      .then((r) => r.data),
};
