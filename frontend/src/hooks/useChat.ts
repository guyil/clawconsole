import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { chatApi } from '../api/chat.api';

const KEYS = {
  nodes: ['chat-nodes'] as const,
  bots: (machineId: string) => ['chat-bots', machineId] as const,
  conversations: ['chat-conversations'] as const,
  messages: (id: string) => ['chat-messages', id] as const,
};

export function useChatNodes() {
  return useQuery({ queryKey: KEYS.nodes, queryFn: chatApi.listNodes });
}

export function useChatBots(machineId: string | null) {
  return useQuery({
    queryKey: KEYS.bots(machineId ?? ''),
    queryFn: () => chatApi.listBots(machineId!),
    enabled: !!machineId,
  });
}

export function useChatConversations() {
  return useQuery({ queryKey: KEYS.conversations, queryFn: chatApi.listConversations });
}

export function useChatMessages(conversationId: string | null) {
  return useQuery({
    queryKey: KEYS.messages(conversationId ?? ''),
    queryFn: () => chatApi.getMessages(conversationId!),
    enabled: !!conversationId,
  });
}

export function useCreateConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: chatApi.createConversation,
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.conversations }),
  });
}

export function useDeleteConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: chatApi.deleteConversation,
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.conversations }),
  });
}

export const chatKeys = KEYS;
