import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { credentialsApi } from '../api/credentials.api';
import type { CreateCredentialInput, UpdateCredentialInput } from '../types/credential';
import toast from 'react-hot-toast';

export const credentialKeys = {
  all: ['credentials'] as const,
  list: (params?: Record<string, string>) => [...credentialKeys.all, 'list', params] as const,
  detail: (id: string) => [...credentialKeys.all, 'detail', id] as const,
};

export function useCredentials(params?: { machineId?: string; provider?: string }) {
  return useQuery({
    queryKey: credentialKeys.list(params as Record<string, string>),
    queryFn: () => credentialsApi.list(params),
  });
}

export function useCreateCredential() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateCredentialInput) => credentialsApi.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: credentialKeys.all });
      toast.success('凭证已创建');
    },
  });
}

export function useUpdateCredential() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateCredentialInput }) =>
      credentialsApi.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: credentialKeys.all });
      toast.success('凭证已更新');
    },
  });
}

export function useDeleteCredential() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => credentialsApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: credentialKeys.all });
      toast.success('凭证已删除');
    },
  });
}

export function useSyncCredential() {
  return useMutation({
    mutationFn: ({ credentialId, machineId }: { credentialId: string; machineId: string }) =>
      credentialsApi.syncToMachine(credentialId, machineId),
    onSuccess: () => {
      toast.success('凭证已同步到节点');
    },
  });
}

export function useSyncAllCredentials() {
  return useMutation({
    mutationFn: (machineId: string) => credentialsApi.syncAllToMachine(machineId),
    onSuccess: (result) => {
      toast.success(`同步完成: ${result.synced} 成功, ${result.failed} 失败`);
    },
  });
}
