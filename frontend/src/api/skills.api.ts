import { api } from './client';
import type { PaginatedResponse } from './client';
import type {
  SkillCatalogEntry,
  CreateSkillInput,
  UpdateSkillInput,
  AgentSkillInstall,
  InstallSkillInput,
} from '../types/skill';

export const skillsApi = {
  list: (params?: { source?: string; scope?: string; reviewStatus?: string; tag?: string }) =>
    api.get<PaginatedResponse<SkillCatalogEntry>>('/skills', { params }).then((r) => r.data),

  listTags: () =>
    api.get<{ data: string[] }>('/skills/tags').then((r) => r.data),

  get: (id: string) =>
    api.get<SkillCatalogEntry>(`/skills/${id}`).then((r) => r.data),

  create: (data: CreateSkillInput) =>
    api.post<SkillCatalogEntry>('/skills', data).then((r) => r.data),

  update: (id: string, data: UpdateSkillInput) =>
    api.patch<SkillCatalogEntry>(`/skills/${id}`, data).then((r) => r.data),

  delete: (id: string) =>
    api.delete(`/skills/${id}`).then((r) => r.data),

  review: (id: string, action: 'approve' | 'reject', reviewedBy: string) =>
    api.post(`/skills/${id}/review`, { action, reviewedBy }).then((r) => r.data),

  listAgentSkills: (agentId: string) =>
    api
      .get<PaginatedResponse<AgentSkillInstall>>(`/agents/${agentId}/skills`)
      .then((r) => r.data),

  installOnAgent: (agentId: string, data: InstallSkillInput) =>
    api.post(`/agents/${agentId}/skills`, data).then((r) => r.data),

  removeFromAgent: (agentId: string, skillCatalogId: string) =>
    api.delete(`/agents/${agentId}/skills/${skillCatalogId}`).then((r) => r.data),

  importFromUrl: (url: string) =>
    api.post<SkillCatalogEntry>('/skills/import-url', { url }).then((r) => r.data),

  importFromLocal: (folderPath: string) =>
    api.post<SkillCatalogEntry>('/skills/import-local', { folderPath }).then((r) => r.data),

  syncLocal: (skillId: string) =>
    api.post<SkillCatalogEntry>(`/skills/${skillId}/sync-local`).then((r) => r.data),

  importFromMachine: (machineId: string, skillKey: string, scope?: string) =>
    api
      .post(`/machines/${machineId}/skills/import`, { skillKey, scope })
      .then((r) => r.data),

  deployToMachine: (skillId: string, machineId: string, scope?: string, agentId?: string) =>
    api
      .post(`/skills/${skillId}/deploy/${machineId}`, { scope, agentId })
      .then((r) => r.data),

  removeDiscoveredSkill: (agentId: string, skillKey: string) =>
    api.delete(`/agents/${agentId}/discovered-skills/${encodeURIComponent(skillKey)}`).then((r) => r.data),

  removeGlobalSkill: (agentId: string, skillKey: string) =>
    api.delete(`/agents/${agentId}/global-skills/${encodeURIComponent(skillKey)}`).then((r) => r.data),

  rediscoverSkills: (agentId: string) =>
    api.post(`/agents/${agentId}/rediscover-skills`).then((r) => r.data),
};
