import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { workflowsApi } from '../api/workflows.api';
import type { CreateWorkflowInput, UpdateWorkflowInput } from '../types/workflow';
import toast from 'react-hot-toast';

export const workflowKeys = {
  all: ['workflows'] as const,
  list: (params?: Record<string, string>) => [...workflowKeys.all, 'list', params] as const,
  detail: (id: string) => [...workflowKeys.all, 'detail', id] as const,
  versions: (id: string) => [...workflowKeys.all, 'versions', id] as const,
  runs: (workflowId: string, params?: Record<string, string>) =>
    [...workflowKeys.all, 'runs', workflowId, params] as const,
  run: (runId: string) => [...workflowKeys.all, 'run', runId] as const,
  runNodes: (runId: string) => [...workflowKeys.all, 'runNodes', runId] as const,
  reviews: ['reviews'] as const,
  pendingReviews: (userId?: string) => [...workflowKeys.reviews, 'pending', userId] as const,
};

export function useWorkflows(params?: { machineId?: string; agentId?: string; status?: string }) {
  return useQuery({
    queryKey: workflowKeys.list(params as Record<string, string>),
    queryFn: () => workflowsApi.list(params),
  });
}

export function useWorkflow(id: string) {
  return useQuery({
    queryKey: workflowKeys.detail(id),
    queryFn: () => workflowsApi.get(id),
    enabled: !!id,
  });
}

export function useCreateWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateWorkflowInput) => workflowsApi.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: workflowKeys.all });
      toast.success('工作流已创建');
    },
  });
}

export function useUpdateWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateWorkflowInput }) =>
      workflowsApi.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: workflowKeys.all });
      toast.success('工作流已保存');
    },
  });
}

export function useDeleteWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => workflowsApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: workflowKeys.all });
      toast.success('工作流已删除');
    },
  });
}

export function useValidateWorkflow() {
  return useMutation({
    mutationFn: (id: string) => workflowsApi.validate(id),
  });
}

export function useDeployWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, deployedBy }: { id: string; deployedBy: string }) =>
      workflowsApi.deploy(id, deployedBy),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: workflowKeys.all });
      toast.success('工作流已部署');
    },
    onError: (err: Error) => {
      toast.error(`部署失败: ${err.message}`);
    },
  });
}

export function useWorkflowYaml(id: string) {
  return useQuery({
    queryKey: [...workflowKeys.detail(id), 'yaml'],
    queryFn: () => workflowsApi.getYaml(id),
    enabled: false,
  });
}

export function useWorkflowVersions(workflowId: string) {
  return useQuery({
    queryKey: workflowKeys.versions(workflowId),
    queryFn: () => workflowsApi.listVersions(workflowId),
    enabled: !!workflowId,
  });
}

// --- Runs ---

export function useWorkflowRuns(workflowId: string, params?: { status?: string }) {
  return useQuery({
    queryKey: workflowKeys.runs(workflowId, params as Record<string, string>),
    queryFn: () => workflowsApi.listRuns(workflowId, params),
    enabled: !!workflowId,
  });
}

export function useWorkflowRun(runId: string) {
  return useQuery({
    queryKey: workflowKeys.run(runId),
    queryFn: () => workflowsApi.getRun(runId),
    enabled: !!runId,
  });
}

export function useWorkflowRunNodes(runId: string) {
  return useQuery({
    queryKey: workflowKeys.runNodes(runId),
    queryFn: () => workflowsApi.getRunNodes(runId),
    enabled: !!runId,
  });
}

export function useAbortRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (runId: string) => workflowsApi.abortRun(runId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: workflowKeys.all });
      toast.success('运行已中止');
    },
  });
}

// --- Reviews ---

export function usePendingReviews(userId?: string) {
  return useQuery({
    queryKey: workflowKeys.pendingReviews(userId),
    queryFn: () => workflowsApi.listPendingReviews(userId),
  });
}

export function useSubmitReviewDecision() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      runId,
      nodeId,
      decision,
      decidedBy,
      comments,
    }: {
      runId: string;
      nodeId: string;
      decision: 'approved' | 'rejected';
      decidedBy: string;
      comments?: string;
    }) => workflowsApi.submitDecision(runId, nodeId, decision, decidedBy, comments),
    onSuccess: (_, { decision }) => {
      qc.invalidateQueries({ queryKey: workflowKeys.reviews });
      qc.invalidateQueries({ queryKey: workflowKeys.all });
      toast.success(decision === 'approved' ? '已批准' : '已拒绝');
    },
  });
}
