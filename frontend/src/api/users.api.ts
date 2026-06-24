import { api } from './client';
import type { PaginatedResponse } from './client';
import type { AuthUser, UserRole } from './auth.api';

export interface ManagedUser extends AuthUser {
  /** Agent UUIDs assigned to this user (developers only; admins => []). */
  assignedAgentIds: string[];
}

export interface CreateUserInput {
  username: string;
  password: string;
  role: UserRole;
}

export interface UpdateUserInput {
  password?: string;
  role?: UserRole;
  status?: 'active' | 'disabled';
}

export const usersApi = {
  list: () => api.get<PaginatedResponse<ManagedUser>>('/users').then((r) => r.data),

  create: (data: CreateUserInput) => api.post<AuthUser>('/users', data).then((r) => r.data),

  update: (id: string, data: UpdateUserInput) =>
    api.patch<AuthUser>(`/users/${id}`, data).then((r) => r.data),

  delete: (id: string) => api.delete(`/users/${id}`).then((r) => r.data),

  getAssignments: (id: string) =>
    api.get<{ data: string[] }>(`/users/${id}/agents`).then((r) => r.data.data),

  setAssignments: (id: string, agentIds: string[]) =>
    api.put<{ data: string[] }>(`/users/${id}/agents`, { agentIds }).then((r) => r.data.data),
};
