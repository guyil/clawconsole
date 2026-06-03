import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { agentsApi } from '../api/agents.api';
import { modelConfigApi } from '../api/model-config.api';
import { agentKeys } from './useAgents';
import { machineKeys } from './useMachines';
import type { AgentModelValue } from '../types/agent';
import toast from 'react-hot-toast';

export const modelConfigKeys = {
  agentModel: (agentId: string) => ['model-config', 'agent', agentId] as const,
  machineModel: (machineId: string) => ['model-config', 'machine', machineId] as const,
  remoteModel: (machineId: string) => ['model-config', 'remote', machineId] as const,
};

// --- Agent-level model config ---

export function useAgentModelConfig(agentId: string) {
  return useQuery({
    queryKey: modelConfigKeys.agentModel(agentId),
    queryFn: () => agentsApi.getModelConfig(agentId),
    enabled: !!agentId,
  });
}

export function useUpdateAgentModelConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, model }: { agentId: string; model: AgentModelValue }) =>
      agentsApi.updateModelConfig(agentId, model),
    onSuccess: (_, { agentId }) => {
      qc.invalidateQueries({ queryKey: modelConfigKeys.agentModel(agentId) });
      qc.invalidateQueries({ queryKey: agentKeys.detail(agentId) });
      toast.success('Model 配置已保存');
    },
    onError: (err: Error) => {
      toast.error(`保存失败: ${err.message}`);
    },
  });
}

export function useSyncAgentModelConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (agentId: string) => agentsApi.syncModelConfig(agentId),
    onSuccess: (_, agentId) => {
      qc.invalidateQueries({ queryKey: modelConfigKeys.agentModel(agentId) });
      qc.invalidateQueries({ queryKey: agentKeys.detail(agentId) });
      toast.success('Model 配置已同步到远程节点');
    },
    onError: (err: Error) => {
      toast.error(`同步失败: ${err.message}`);
    },
  });
}

export function useDeleteAgentModelConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (agentId: string) => agentsApi.deleteModelConfig(agentId),
    onSuccess: (_, agentId) => {
      qc.invalidateQueries({ queryKey: modelConfigKeys.agentModel(agentId) });
      qc.invalidateQueries({ queryKey: agentKeys.detail(agentId) });
      toast.success('Model 配置已清除');
    },
    onError: (err: Error) => {
      toast.error(`清除失败: ${err.message}`);
    },
  });
}

// --- Machine-level model config ---

export function useMachineModelConfig(machineId: string) {
  return useQuery({
    queryKey: modelConfigKeys.machineModel(machineId),
    queryFn: () => modelConfigApi.getMachineModelConfig(machineId),
    enabled: !!machineId,
  });
}

export function useRemoteModelConfig(machineId: string) {
  return useQuery({
    queryKey: modelConfigKeys.remoteModel(machineId),
    queryFn: () => modelConfigApi.getRemoteModelConfig(machineId),
    enabled: !!machineId,
  });
}

export function useUpdateMachineModelConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ machineId, model }: { machineId: string; model: AgentModelValue }) =>
      modelConfigApi.updateMachineModelConfig(machineId, model),
    onSuccess: (_, { machineId }) => {
      qc.invalidateQueries({ queryKey: modelConfigKeys.machineModel(machineId) });
      qc.invalidateQueries({ queryKey: machineKeys.detail(machineId) });
      toast.success('全局 Model 配置已保存');
    },
    onError: (err: Error) => {
      toast.error(`保存失败: ${err.message}`);
    },
  });
}

export function useSyncMachineModelConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (machineId: string) => modelConfigApi.syncMachineModelConfig(machineId),
    onSuccess: (_, machineId) => {
      qc.invalidateQueries({ queryKey: modelConfigKeys.machineModel(machineId) });
      qc.invalidateQueries({ queryKey: machineKeys.detail(machineId) });
      toast.success('全局 Model 配置已同步到远程节点');
    },
    onError: (err: Error) => {
      toast.error(`同步失败: ${err.message}`);
    },
  });
}
