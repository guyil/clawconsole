import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { usersApi, type CreateUserInput, type UpdateUserInput } from '../api/users.api';
import toast from 'react-hot-toast';

export const userKeys = {
  all: ['users'] as const,
  list: () => [...userKeys.all, 'list'] as const,
  assignments: (id: string) => [...userKeys.all, 'assignments', id] as const,
};

export function useUsers() {
  return useQuery({
    queryKey: userKeys.list(),
    queryFn: () => usersApi.list(),
  });
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateUserInput) => usersApi.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: userKeys.all });
      toast.success('用户已创建');
    },
  });
}

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateUserInput }) =>
      usersApi.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: userKeys.all });
      toast.success('用户已更新');
    },
  });
}

export function useDeleteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => usersApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: userKeys.all });
      toast.success('用户已删除');
    },
  });
}

export function useSetAssignments() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, agentIds }: { id: string; agentIds: string[] }) =>
      usersApi.setAssignments(id, agentIds),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: userKeys.all });
      toast.success('Bot 分配已更新');
    },
  });
}
