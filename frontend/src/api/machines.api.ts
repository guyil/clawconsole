import { api } from './client';
import type { PaginatedResponse } from './client';
import type {
  Machine,
  CreateMachineInput,
  UpdateMachineInput,
  MachineHealthCheck,
  MachineDiscovery,
} from '../types/machine';

export const machinesApi = {
  list: (params?: { status?: string; tag?: string }) =>
    api.get<PaginatedResponse<Machine>>('/machines', { params }).then((r) => r.data),

  get: (id: string) =>
    api.get<Machine>(`/machines/${id}`).then((r) => r.data),

  create: (data: CreateMachineInput) =>
    api.post<Machine>('/machines', data).then((r) => r.data),

  update: (id: string, data: UpdateMachineInput) =>
    api.patch<Machine>(`/machines/${id}`, data).then((r) => r.data),

  delete: (id: string) =>
    api.delete(`/machines/${id}`).then((r) => r.data),

  healthCheck: (id: string) =>
    api.post<MachineHealthCheck>(`/machines/${id}/health-check`).then((r) => r.data),

  discover: (id: string) =>
    api.post<MachineDiscovery>(`/machines/${id}/discover`).then((r) => r.data),
};
