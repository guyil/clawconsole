import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { filesApi } from '../api/files.api';
import type { FileListFilters } from '../types/file';
import toast from 'react-hot-toast';

export const fileKeys = {
  all: ['files'] as const,
  byMachine: (machineId: string, filters?: FileListFilters) =>
    [...fileKeys.all, 'machine', machineId, filters] as const,
  byAgent: (agentId: string) => [...fileKeys.all, 'agent', agentId] as const,
  detail: (fileId: string) => [...fileKeys.all, 'detail', fileId] as const,
};

export function useFilesByMachine(machineId: string, filters?: FileListFilters) {
  return useQuery({
    queryKey: fileKeys.byMachine(machineId, filters),
    queryFn: () => filesApi.listByMachine(machineId, filters),
    enabled: !!machineId,
  });
}

export function useFile(fileId: string) {
  return useQuery({
    queryKey: fileKeys.detail(fileId),
    queryFn: () => filesApi.get(fileId),
    enabled: !!fileId,
  });
}

export function useUpdateFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ fileId, content }: { fileId: string; content: string }) =>
      filesApi.update(fileId, content),
    onSuccess: (_, { fileId }) => {
      qc.invalidateQueries({ queryKey: fileKeys.detail(fileId) });
      qc.invalidateQueries({ queryKey: fileKeys.all });
      toast.success('文件已保存');
    },
  });
}
