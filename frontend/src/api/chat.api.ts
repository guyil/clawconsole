import { api } from './client';
import { getToken } from './auth.api';

export interface ChatNode {
  id: string;
  name: string;
  host: string;
  gatewayPort: number;
  status: 'online' | 'offline' | 'unknown';
  agentCount: number;
}

export interface ChatBot {
  agentId: string;
  name: string | null;
}

export interface ChatConversation {
  id: string;
  machineId: string;
  agentId: string;
  title: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

export const chatApi = {
  async listNodes(): Promise<ChatNode[]> {
    const { data } = await api.get<{ data: ChatNode[] }>('/chat/nodes');
    return data.data;
  },
  async listBots(machineId: string): Promise<ChatBot[]> {
    const { data } = await api.get<{ data: ChatBot[] }>(`/chat/nodes/${machineId}/bots`);
    return data.data;
  },
  async listConversations(): Promise<ChatConversation[]> {
    const { data } = await api.get<{ data: ChatConversation[] }>('/chat/conversations');
    return data.data;
  },
  async createConversation(input: {
    machineId: string;
    agentId: string;
    title?: string;
  }): Promise<ChatConversation> {
    const { data } = await api.post<ChatConversation>('/chat/conversations', input);
    return data;
  },
  async getMessages(conversationId: string): Promise<ChatMessage[]> {
    const { data } = await api.get<{ data: ChatMessage[] }>(
      `/chat/conversations/${conversationId}/messages`,
    );
    return data.data;
  },
  async deleteConversation(conversationId: string): Promise<void> {
    await api.delete(`/chat/conversations/${conversationId}`);
  },
};

/**
 * Stream a chat turn over SSE. Yields the gateway's tokens as they arrive.
 * Uses native fetch (axios can't stream); attaches the bearer token manually.
 */
export async function* streamChat(
  conversationId: string,
  message: string,
): AsyncGenerator<{ type: string; data: Record<string, unknown> }> {
  const baseUrl = api.defaults.baseURL ?? '/api';
  const token = getToken();
  const response = await fetch(`${baseUrl}/chat/conversations/${conversationId}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ message }),
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    let currentEvent = '';
    for (const line of lines) {
      if (line.startsWith('event: ')) {
        currentEvent = line.slice(7).trim();
      } else if (line.startsWith('data: ') && currentEvent) {
        try {
          yield { type: currentEvent, data: JSON.parse(line.slice(6)) };
        } catch {
          // skip malformed
        }
        currentEvent = '';
      }
    }
  }
}
