import { api } from './client';

export interface PendingChange {
  filename: string;
  originalContent: string;
  currentContent: string;
  managedFileId: string | null;
}

export interface SyncConfigResult {
  syncedFiles: number;
  failedFiles: number;
  errors: string[];
}

export interface SessionInfo {
  sessionId: string;
  fileCount: number;
  dirtyCount: number;
  messageCount: number;
}

export const botConfigAgentApi = {
  getChanges: (agentId: string) =>
    api
      .get<{ data: PendingChange[]; total: number }>(`/agents/${agentId}/config-chat/changes`)
      .then((r) => r.data),

  syncChanges: (agentId: string) =>
    api
      .post<SyncConfigResult>(`/agents/${agentId}/config-chat/sync`)
      .then((r) => r.data),

  getSession: (agentId: string) =>
    api
      .get<{ data: SessionInfo | null }>(`/agents/${agentId}/config-chat/session`)
      .then((r) => r.data),

  resetSession: (agentId: string) =>
    api.delete(`/agents/${agentId}/config-chat/session`),
};

/**
 * SSE stream for the bot config chat.
 * Reuses the same pattern as the playground chat SSE.
 */
export async function* streamConfigChat(
  agentId: string,
  message: string,
): AsyncGenerator<{ type: string; data: Record<string, unknown> }> {
  const baseUrl = api.defaults.baseURL ?? '/api';
  const response = await fetch(`${baseUrl}/agents/${agentId}/config-chat`, {
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
