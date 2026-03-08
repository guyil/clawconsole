import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { workflowsApi } from '../api/workflows.api';
import type { CreateWorkflowInput, UpdateWorkflowInput } from '../types/workflow';
import toast from 'react-hot-toast';

export const workflowKeys = {
  all: ['workflows'] as const,
  list: (params?: Record<string, string>) => [...workflowKeys.all, 'list', params] as const,
  detail: (id: string) => [...workflowKeys.all, 'detail', id] as const,
  versions: (id: string) => [...workflowKeys.all, 'versions', id] as const,
};

export function useWorkflows(params?: { machineId?: string; agentId?: string; status?: string }) {
  return useQuery({
    queryKey: workflowKeys.list(params as Record<string, string>),
    queryFn: () => workflowsApi.list(params),
  });
}

export function useWorkflow(id: string) {
  return useQuery({
    queryKey: workflowKeys.detail(id),
    queryFn: () => workflowsApi.get(id),
    enabled: !!id,
  });
}

export function useCreateWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateWorkflowInput) => workflowsApi.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: workflowKeys.all });
      toast.success('工作流已创建');
    },
  });
}

export function useUpdateWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateWorkflowInput }) =>
      workflowsApi.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: workflowKeys.all });
      toast.success('工作流已保存');
    },
  });
}

export function useDeleteWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => workflowsApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: workflowKeys.all });
      toast.success('工作流已删除');
    },
  });
}

export function useValidateWorkflow() {
  return useMutation({
    mutationFn: (id: string) => workflowsApi.validate(id),
  });
}

export function useDeployWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, machineId, scope, agentId }: { id: string; machineId: string; scope?: string; agentId?: string }) =>
      workflowsApi.deploy(id, machineId, scope, agentId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: workflowKeys.all });
      toast.success('工作流已部署');
    },
    onError: (err: Error) => {
      toast.error(`部署失败: ${err.message}`);
    },
  });
}

export function useWorkflowYaml(id: string) {
  return useQuery({
    queryKey: [...workflowKeys.detail(id), 'yaml'],
    queryFn: () => workflowsApi.getYaml(id),
    enabled: false,
  });
}

export function useWorkflowVersions(workflowId: string) {
  return useQuery({
    queryKey: workflowKeys.versions(workflowId),
    queryFn: () => workflowsApi.listVersions(workflowId),
    enabled: !!workflowId,
  });
}
