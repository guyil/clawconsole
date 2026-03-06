import { api } from './client';
import type { AssistantSession } from '../types/assistant';

export const assistantApi = {
  listSessions: () =>
    api.get<{ data: AssistantSession[]; total: number }>('/assistant/sessions').then((r) => r.data),

  createSession: (title?: string) =>
    api.post<AssistantSession>('/assistant/sessions', { title }).then((r) => r.data),

  getSession: (id: string) =>
    api.get<AssistantSession>(`/assistant/sessions/${id}`).then((r) => r.data),

  deleteSession: (id: string) =>
    api.delete(`/assistant/sessions/${id}`),
};

/**
 * SSE stream for the assistant chat.
 * Follows the same pattern as playground streamSSE.
 */
export async function* streamAssistantChat(
  sessionId: string,
  message: string,
): AsyncGenerator<{ type: string; data: Record<string, unknown> }> {
  const baseUrl = api.defaults.baseURL ?? '/api';
  const response = await fetch(`${baseUrl}/assistant/sessions/${sessionId}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
          const data = JSON.parse(line.slice(6));
          yield { type: currentEvent, data };
        } catch {
          // skip malformed JSON
        }
        currentEvent = '';
      }
    }
  }
}
