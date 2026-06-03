import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  summariesApi,
  type GenerateSummaryPayload,
  type SummaryListParams,
} from '../api/summaries.api';

export const summaryKeys = {
  all: ['summaries'] as const,
  status: () => [...summaryKeys.all, 'status'] as const,
  list: (params?: SummaryListParams) =>
    [...summaryKeys.all, 'list', params] as const,
  detail: (id: number) => [...summaryKeys.all, 'detail', id] as const,
  pushConfig: () => [...summaryKeys.all, 'push-config'] as const,
};

export function useSummaryStatus() {
  return useQuery({
    queryKey: summaryKeys.status(),
    queryFn: summariesApi.status,
  });
}

export function useSummariesList(params?: SummaryListParams) {
  return useQuery({
    queryKey: summaryKeys.list(params),
    queryFn: () => summariesApi.list(params),
    refetchInterval: 60_000,
  });
}

export function useSummaryDetail(id: number | null) {
  return useQuery({
    queryKey: summaryKeys.detail(id ?? 0),
    queryFn: () => summariesApi.get(id as number),
    enabled: id != null && id > 0,
  });
}

export function useSummaryPushConfig() {
  return useQuery({
    queryKey: summaryKeys.pushConfig(),
    queryFn: summariesApi.listPushConfig,
  });
}

export function useSetSummaryPushEnabled() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentUuid, enabled }: { agentUuid: string; enabled: boolean }) =>
      summariesApi.setPushEnabled(agentUuid, enabled),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: summaryKeys.pushConfig() });
    },
  });
}

export function useGenerateSummary() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: GenerateSummaryPayload) => summariesApi.generate(payload),
    onSuccess: (resp) => {
      qc.invalidateQueries({ queryKey: summaryKeys.all });
      const success = resp.results.filter((r) => r.status === 'success').length;
      const empty = resp.results.filter((r) => r.status === 'empty').length;
      const failed = resp.results.filter((r) => r.status === 'failed').length;
      const pushed = resp.results.filter((r) => r.pushed).length;
      const msg = `生成 ${resp.results.length} 项：成功 ${success}、空窗口 ${empty}、失败 ${failed}；已推送 ${pushed}`;
      if (failed > 0) toast.error(msg);
      else toast.success(msg);
    },
  });
}
