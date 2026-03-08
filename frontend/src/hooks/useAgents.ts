import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { agentsApi } from '../api/agents.api';
import type { CreateAgentInput, UpdateAgentInput, ProvisionInput } from '../types/agent';
import toast from 'react-hot-toast';

export const agentKeys = {
  all: ['agents'] as const,
  list: () => [...agentKeys.all, 'list'] as const,
  byMachine: (machineId: string) => [...agentKeys.all, 'machine', machineId] as const,
  detail: (agentId: string) => [...agentKeys.all, 'detail', agentId] as const,
  configFiles: (agentId: string) => [...agentKeys.all, 'config-files', agentId] as const,
  memoryFiles: (agentId: string) => [...agentKeys.all, 'memory-files', agentId] as const,
};

export function useAllAgents() {
  return useQuery({
    queryKey: agentKeys.list(),
    queryFn: () => agentsApi.listAll(),
  });
}

export function useAgentsByMachine(machineId: string) {
  return useQuery({
    queryKey: agentKeys.byMachine(machineId),
    queryFn: () => agentsApi.listByMachine(machineId),
    enabled: !!machineId,
  });
}

export function useAgent(agentId: string) {
  return useQuery({
    queryKey: agentKeys.detail(agentId),
    queryFn: () => agentsApi.get(agentId),
    enabled: !!agentId,
  });
}

export function useAgentConfigFiles(agentId: string) {
  return useQuery({
    queryKey: agentKeys.configFiles(agentId),
    queryFn: () => agentsApi.getConfigFiles(agentId),
    enabled: !!agentId,
  });
}

export function useAgentMemoryFiles(agentId: string) {
  return useQuery({
    queryKey: agentKeys.memoryFiles(agentId),
    queryFn: () => agentsApi.getMemoryFiles(agentId),
    enabled: !!agentId,
  });
}

export function useCreateAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ machineId, data }: { machineId: string; data: CreateAgentInput }) =>
      agentsApi.create(machineId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: agentKeys.all });
    },
    onError: (err: Error) => {
      toast.error(`创建失败: ${err.message}`);
    },
  });
}

export function useUpdateAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, data }: { agentId: string; data: UpdateAgentInput }) =>
      agentsApi.update(agentId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: agentKeys.all });
      toast.success('Agent 已更新');
    },
  });
}

export function useProvisionAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, channels }: { agentId: string; channels?: ProvisionInput['channels'] }) =>
      agentsApi.provision(agentId, { channels }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: agentKeys.all });
      toast.success('Bot 部署成功');
    },
    onError: (err: Error) => {
      toast.error(`部署失败: ${err.message}`);
    },
  });
}
