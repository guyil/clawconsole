import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { machinesApi } from '../api/machines.api';
import type { CreateMachineInput, UpdateMachineInput, MachineDiscovery } from '../types/machine';
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

export function useHealthCheck(options?: { silent?: boolean }) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => machinesApi.healthCheck(id),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: machineKeys.detail(id) });
      qc.invalidateQueries({ queryKey: machineKeys.all });
      if (!options?.silent) toast.success('健康检查完成');
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

export interface DiscoverAllResult {
  scanned: number;
  succeeded: number;
  failed: Array<{ machineId: string; machineName: string; error: string }>;
  perMachine: Array<{ machineId: string; machineName: string; result: MachineDiscovery }>;
  totals: { agents: number; globalSkills: number };
}

/**
 * Discover workspace folders on every reachable (online) machine in parallel.
 *
 * Useful for the global "刷新 Bot 列表" button on the Bots page: each machine's
 * discovery upserts any new `workspace-*` folders into the agents table as
 * draft records, so newly-created bots show up without having to navigate
 * into each machine's detail page.
 */
export function useDiscoverAll() {
  const qc = useQueryClient();
  return useMutation<DiscoverAllResult>({
    mutationFn: async () => {
      const machines = (await machinesApi.list()).data;
      const targets = machines.filter((m) => m.status === 'online');

      const settled = await Promise.allSettled(
        targets.map(async (m) => ({
          machineId: m.id,
          machineName: m.name,
          result: await machinesApi.discover(m.id),
        })),
      );

      const perMachine: DiscoverAllResult['perMachine'] = [];
      const failed: DiscoverAllResult['failed'] = [];
      let agentTotal = 0;
      let skillTotal = 0;

      settled.forEach((s, i) => {
        const m = targets[i];
        if (s.status === 'fulfilled') {
          perMachine.push(s.value);
          agentTotal += s.value.result.agents.length;
          skillTotal += s.value.result.globalSkills.length;
        } else {
          failed.push({
            machineId: m.id,
            machineName: m.name,
            error: s.reason instanceof Error ? s.reason.message : String(s.reason),
          });
        }
      });

      return {
        scanned: targets.length,
        succeeded: perMachine.length,
        failed,
        perMachine,
        totals: { agents: agentTotal, globalSkills: skillTotal },
      };
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: machineKeys.all });
      qc.invalidateQueries({ queryKey: agentKeys.all });
      if (result.scanned === 0) {
        toast('没有在线节点可扫描', { icon: 'ℹ️' });
        return;
      }
      const summary = `扫描 ${result.succeeded}/${result.scanned} 节点 · 共 ${result.totals.agents} 个 Bot`;
      if (result.failed.length > 0) {
        toast.error(`${summary}（${result.failed.length} 个失败）`);
      } else {
        toast.success(summary);
      }
    },
    onError: (err: Error) => {
      toast.error(`刷新失败: ${err.message}`);
    },
  });
}
