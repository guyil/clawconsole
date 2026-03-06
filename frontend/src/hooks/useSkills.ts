import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { skillsApi } from '../api/skills.api';
import type { CreateSkillInput, UpdateSkillInput, InstallSkillInput } from '../types/skill';
import toast from 'react-hot-toast';

export const skillKeys = {
  all: ['skills'] as const,
  list: (params?: Record<string, string>) => [...skillKeys.all, 'list', params] as const,
  detail: (id: string) => [...skillKeys.all, 'detail', id] as const,
  agentSkills: (agentId: string) => [...skillKeys.all, 'agent', agentId] as const,
};

export function useSkills(params?: { source?: string; scope?: string; reviewStatus?: string }) {
  return useQuery({
    queryKey: skillKeys.list(params as Record<string, string>),
    queryFn: () => skillsApi.list(params),
  });
}

export function useSkill(id: string) {
  return useQuery({
    queryKey: skillKeys.detail(id),
    queryFn: () => skillsApi.get(id),
    enabled: !!id,
  });
}

export function useCreateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateSkillInput) => skillsApi.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: skillKeys.all });
      toast.success('Skill 已添加');
    },
  });
}

export function useUpdateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateSkillInput }) =>
      skillsApi.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: skillKeys.all });
      toast.success('Skill 已更新');
    },
  });
}

export function useDeleteSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => skillsApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: skillKeys.all });
      toast.success('Skill 已删除');
    },
  });
}

export function useReviewSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action, reviewedBy }: { id: string; action: 'approve' | 'reject'; reviewedBy: string }) =>
      skillsApi.review(id, action, reviewedBy),
    onSuccess: (_, { action }) => {
      qc.invalidateQueries({ queryKey: skillKeys.all });
      toast.success(action === 'approve' ? 'Skill 已审核通过' : 'Skill 已拒绝');
    },
  });
}

export function useAgentSkills(agentId: string) {
  return useQuery({
    queryKey: skillKeys.agentSkills(agentId),
    queryFn: () => skillsApi.listAgentSkills(agentId),
    enabled: !!agentId,
  });
}

export function useInstallSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, data }: { agentId: string; data: InstallSkillInput }) =>
      skillsApi.installOnAgent(agentId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: skillKeys.all });
      toast.success('Skill 已安装');
    },
  });
}

export function useRemoveSkillFromAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, skillCatalogId }: { agentId: string; skillCatalogId: string }) =>
      skillsApi.removeFromAgent(agentId, skillCatalogId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: skillKeys.all });
      toast.success('Skill 已卸载');
    },
  });
}

export function useImportSkillFromUrl() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (url: string) => skillsApi.importFromUrl(url),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: skillKeys.all });
      toast.success('Skill 已从 URL 导入');
    },
    onError: (err: Error) => {
      toast.error(`导入失败: ${err.message}`);
    },
  });
}

export function useImportSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ machineId, skillKey, scope }: { machineId: string; skillKey: string; scope?: string }) =>
      skillsApi.importFromMachine(machineId, skillKey, scope),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: skillKeys.all });
      toast.success('Skill 已导入');
    },
  });
}

export function useDeploySkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ skillId, machineId, scope, agentId }: { skillId: string; machineId: string; scope?: string; agentId?: string }) =>
      skillsApi.deployToMachine(skillId, machineId, scope, agentId),
    onSuccess: () => {
      toast.success('Skill 已部署');
    },
    onError: (err: Error) => {
      toast.error(`部署失败: ${err.message}`);
    },
  });
}
