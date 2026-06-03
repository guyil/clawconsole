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

export function useDeleteAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, cleanRemote = true }: { agentId: string; cleanRemote?: boolean }) =>
      agentsApi.delete(agentId, cleanRemote),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: agentKeys.all });
      toast.success('Bot 已删除');
    },
    onError: (err: Error) => {
      toast.error(`删除失败: ${err.message}`);
    },
  });
}

export function useUpdateAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, data }: { agentId: string; data: UpdateAgentInput }) =>
      agentsApi.update(agentId, data),
    onSuccess: (updated, vars) => {
      // Seed the detail cache with the fresh row first so the open
      // BotDetailPage flips to the new value on the same tick, then
      // invalidate the broader list/byMachine queries (which the
      // BotsPage etc. read off of) so they re-fetch in the background.
      qc.setQueryData(agentKeys.detail(vars.agentId), (prev: unknown) =>
        prev && typeof prev === 'object' ? { ...prev, ...updated } : updated,
      );
      qc.invalidateQueries({ queryKey: agentKeys.list() });
      qc.invalidateQueries({ queryKey: agentKeys.detail(vars.agentId) });
      toast.success('已保存');
    },
    onError: (err: Error) => {
      toast.error(`保存失败: ${err.message}`);
    },
  });
}

/**
 * Toggle the per-bot opt-in for the nightly ``daily-oss-backup`` cron.
 *
 * Why a dedicated hook (vs. reusing ``useUpdateAgent``)
 * ----------------------------------------------------
 *   - Toast copy is bot-specific ("已加入每日同步" / "已退出每日同步"
 *     reads cleaner than the generic "已保存"). The toggle UI fires very
 *     frequently while users curate which bots auto-sync, and a vague
 *     toast is easy to mis-attribute to a different setting they just
 *     touched.
 *   - Decouples cache invalidation: the BotDetailPage and the
 *     DistillStatusModal both render the flag, but only the modal owns
 *     the ``distill-status`` query key. Touching that key from inside
 *     ``useUpdateAgent`` (which all rename / status edits go through)
 *     would over-fetch the status endpoint on every rename.
 */
export function useToggleAgentOssSync() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, enabled }: { agentId: string; enabled: boolean }) =>
      agentsApi.update(agentId, { ossSyncEnabled: enabled }),
    onSuccess: (updated, vars) => {
      qc.setQueryData(agentKeys.detail(vars.agentId), (prev: unknown) =>
        prev && typeof prev === 'object' ? { ...prev, ...updated } : updated,
      );
      qc.invalidateQueries({ queryKey: agentKeys.list() });
      qc.invalidateQueries({ queryKey: agentKeys.detail(vars.agentId) });
      // Distill status modal reads ``ossSyncEnabled`` per agent. Bump
      // the snapshot so the badge flips on the same tick as the toggle.
      qc.invalidateQueries({ queryKey: ['distill-status'] });
      toast.success(vars.enabled ? '已加入每日蒸馏到 OSS' : '已退出每日蒸馏到 OSS');
    },
    onError: (err: Error) => {
      toast.error(`保存失败: ${err.message}`);
    },
  });
}

export function useProvisionAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, channels, copyFromAgentId }: { agentId: string; channels?: ProvisionInput['channels']; copyFromAgentId?: string }) =>
      agentsApi.provision(agentId, { channels, copyFromAgentId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: agentKeys.all });
      toast.success('Bot 部署成功');
    },
    onError: (err: Error) => {
      toast.error(`部署失败: ${err.message}`);
    },
  });
}
