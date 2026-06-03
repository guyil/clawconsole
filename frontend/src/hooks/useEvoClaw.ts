import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { evoClawApi } from '../api/evo-claw.api';
import toast from 'react-hot-toast';

export const evoClawKeys = {
  all: ['evo-claw'] as const,
  runs: (agentId: string) => [...evoClawKeys.all, 'runs', agentId] as const,
  runDetail: (agentId: string, runId: number) => [...evoClawKeys.all, 'run', agentId, runId] as const,
  rules: (agentId: string) => [...evoClawKeys.all, 'rules', agentId] as const,
  cases: (agentId: string) => [...evoClawKeys.all, 'cases', agentId] as const,
};

export function useEvoRuns(agentId: string, machineId?: string) {
  return useQuery({
    queryKey: evoClawKeys.runs(agentId),
    queryFn: () => evoClawApi.listRuns(agentId, { machineId, limit: 50 }),
    enabled: !!agentId,
  });
}

export function useEvoRunDetail(agentId: string, runId: number) {
  return useQuery({
    queryKey: evoClawKeys.runDetail(agentId, runId),
    queryFn: () => evoClawApi.getRunDetail(agentId, runId),
    enabled: !!agentId && runId > 0,
  });
}

export function useEvoRules(agentId: string, machineId?: string) {
  return useQuery({
    queryKey: evoClawKeys.rules(agentId),
    queryFn: () => evoClawApi.listRules(agentId, { machineId, status: 'active' }),
    enabled: !!agentId,
  });
}

export function useEvoCases(agentId: string, machineId?: string) {
  return useQuery({
    queryKey: evoClawKeys.cases(agentId),
    queryFn: () => evoClawApi.listCases(agentId, { machineId, status: 'active' }),
    enabled: !!agentId,
  });
}

export function useTriggerEvolution() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, machineId }: { agentId: string; machineId: string }) =>
      evoClawApi.triggerEvolution(agentId, machineId),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: evoClawKeys.runs(variables.agentId) });
      qc.invalidateQueries({ queryKey: evoClawKeys.rules(variables.agentId) });
      qc.invalidateQueries({ queryKey: evoClawKeys.cases(variables.agentId) });
      toast.success('进化运行已完成');
    },
    onError: (err: Error) => {
      toast.error(`进化失败: ${err.message}`);
    },
  });
}

export function useDeleteEvoRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, ruleId }: { agentId: string; ruleId: number }) =>
      evoClawApi.deleteRule(agentId, ruleId),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: evoClawKeys.rules(variables.agentId) });
      toast.success('规则已废弃');
    },
  });
}

export function useDeleteEvoCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, caseId }: { agentId: string; caseId: number }) =>
      evoClawApi.deleteCase(agentId, caseId),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: evoClawKeys.cases(variables.agentId) });
      toast.success('案例已移除');
    },
  });
}
