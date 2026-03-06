import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { botConfigAgentApi } from '../api/bot-config-agent.api';
import toast from 'react-hot-toast';

export const botConfigKeys = {
  all: ['bot-config-agent'] as const,
  changes: (agentId: string) => [...botConfigKeys.all, 'changes', agentId] as const,
  session: (agentId: string) => [...botConfigKeys.all, 'session', agentId] as const,
};

export function usePendingChanges(agentId: string) {
  return useQuery({
    queryKey: botConfigKeys.changes(agentId),
    queryFn: () => botConfigAgentApi.getChanges(agentId),
    enabled: !!agentId,
    refetchInterval: 5000,
  });
}

export function useConfigSession(agentId: string) {
  return useQuery({
    queryKey: botConfigKeys.session(agentId),
    queryFn: () => botConfigAgentApi.getSession(agentId),
    enabled: !!agentId,
  });
}

export function useSyncConfig(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => botConfigAgentApi.syncChanges(agentId),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: botConfigKeys.changes(agentId) });
      qc.invalidateQueries({ queryKey: botConfigKeys.session(agentId) });
      if (result.failedFiles === 0) {
        toast.success(`已同步 ${result.syncedFiles} 个配置文件`);
      } else {
        toast.error(`同步部分失败：${result.failedFiles} 个文件失败`);
      }
    },
    onError: () => {
      toast.error('同步失败');
    },
  });
}

export function useResetConfigSession(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => botConfigAgentApi.resetSession(agentId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: botConfigKeys.changes(agentId) });
      qc.invalidateQueries({ queryKey: botConfigKeys.session(agentId) });
      toast.success('会话已重置');
    },
  });
}
