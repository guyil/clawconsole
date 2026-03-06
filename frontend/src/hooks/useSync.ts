import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { syncApi } from '../api/sync.api';
import type { PushInput } from '../types/sync';
import { fileKeys } from './useFiles';
import toast from 'react-hot-toast';

export const syncKeys = {
  all: ['sync'] as const,
  operations: (machineId: string) => [...syncKeys.all, 'operations', machineId] as const,
  plan: (machineId: string) => [...syncKeys.all, 'plan', machineId] as const,
};

export function useSyncOperations(machineId: string, params?: { status?: string; page?: number; pageSize?: number }) {
  return useQuery({
    queryKey: [...syncKeys.operations(machineId), params],
    queryFn: () => syncApi.listOperations(machineId, params),
    enabled: !!machineId,
  });
}

export function useSyncPlan(machineId: string, enabled = false) {
  return useQuery({
    queryKey: syncKeys.plan(machineId),
    queryFn: () => syncApi.plan(machineId),
    enabled: !!machineId && enabled,
  });
}

export function usePull() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (machineId: string) => syncApi.pull(machineId),
    onSuccess: (result, machineId) => {
      qc.invalidateQueries({ queryKey: syncKeys.operations(machineId) });
      qc.invalidateQueries({ queryKey: fileKeys.all });
      toast.success(`拉取完成: ${result.totalPulled} 个文件`);
    },
  });
}

export function usePush() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ machineId, data }: { machineId: string; data?: PushInput }) =>
      syncApi.push(machineId, data),
    onSuccess: (result, { machineId }) => {
      qc.invalidateQueries({ queryKey: syncKeys.operations(machineId) });
      qc.invalidateQueries({ queryKey: fileKeys.all });
      toast.success(`推送完成: ${result.syncedFiles} 个文件`);
    },
  });
}

export function useFullSync() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (machineId: string) => syncApi.fullSync(machineId),
    onSuccess: (_, machineId) => {
      qc.invalidateQueries({ queryKey: syncKeys.operations(machineId) });
      qc.invalidateQueries({ queryKey: fileKeys.all });
      toast.success('全量同步完成');
    },
  });
}

export function useRetrySync() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (operationId: string) => syncApi.retryOperation(operationId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: syncKeys.all });
      toast.success('重试已触发');
    },
  });
}
