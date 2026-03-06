import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { machinesApi } from '../api/machines.api';
import type { CreateMachineInput, UpdateMachineInput } from '../types/machine';
import { agentKeys } from './useAgents';
import toast from 'react-hot-toast';

export const machineKeys = {
  all: ['machines'] as const,
  list: (params?: Record<string, string>) => [...machineKeys.all, 'list', params] as const,
  detail: (id: string) => [...machineKeys.all, 'detail', id] as const,
};

export function useMachines(params?: { status?: string; tag?: string }) {
  return useQuery({
    queryKey: machineKeys.list(params as Record<string, string>),
    queryFn: () => machinesApi.list(params),
  });
}

export function useMachine(id: string) {
  return useQuery({
    queryKey: machineKeys.detail(id),
    queryFn: () => machinesApi.get(id),
    enabled: !!id,
  });
}

export function useCreateMachine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateMachineInput) => machinesApi.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: machineKeys.all });
      toast.success('节点已注册');
    },
  });
}

export function useUpdateMachine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateMachineInput }) =>
      machinesApi.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: machineKeys.all });
      toast.success('节点已更新');
    },
  });
}

export function useDeleteMachine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => machinesApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: machineKeys.all });
      toast.success('节点已删除');
    },
  });
}

export function useHealthCheck() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => machinesApi.healthCheck(id),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: machineKeys.detail(id) });
      qc.invalidateQueries({ queryKey: machineKeys.all });
      toast.success('健康检查完成');
    },
  });
}

export function useDiscover() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => machinesApi.discover(id),
    onSuccess: (result, id) => {
      qc.invalidateQueries({ queryKey: machineKeys.detail(id) });
      qc.invalidateQueries({ queryKey: machineKeys.all });
      qc.invalidateQueries({ queryKey: agentKeys.byMachine(id) });
      toast.success(`发现 ${result.agents.length} 个 Agent，${result.globalSkills.length} 个 Skill`);
    },
  });
}
