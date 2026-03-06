import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { assistantApi } from '../api/assistant.api';
import toast from 'react-hot-toast';

const KEYS = {
  sessions: ['assistant-sessions'] as const,
  session: (id: string) => ['assistant-session', id] as const,
};

export function useAssistantSessions() {
  return useQuery({
    queryKey: KEYS.sessions,
    queryFn: assistantApi.listSessions,
  });
}

export function useAssistantSession(id: string | null) {
  return useQuery({
    queryKey: KEYS.session(id ?? ''),
    queryFn: () => assistantApi.getSession(id!),
    enabled: !!id,
  });
}

export function useCreateAssistantSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (title?: string) => assistantApi.createSession(title),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.sessions });
    },
  });
}

export function useDeleteAssistantSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => assistantApi.deleteSession(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.sessions });
      toast.success('会话已删除');
    },
  });
}
