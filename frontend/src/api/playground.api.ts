import { api } from './client';
import type {
  PlaygroundSession,
  ValidateSkillResult,
  SecurityScanResult,
  ParsedSkill,
  SkillVersion,
  SkillTemplate,
  SkillFile,
  BotIdentityFile,
} from '../types/playground';

export const playgroundApi = {
  // --- Sessions ---
  createSession: (data: {
    skillCatalogId?: string;
    skillMdContent: string;
    agentId?: string;
    identityFiles?: BotIdentityFile[];
    config?: Partial<PlaygroundSession['config']>;
  }) => api.post<PlaygroundSession>('/playground/sessions', data).then((r) => r.data),

  listSessions: (params?: { status?: string; skillCatalogId?: string }) =>
    api.get<{ data: PlaygroundSession[]; total: number }>('/playground/sessions', { params }).then((r) => r.data),

  getSession: (id: string) =>
    api.get<PlaygroundSession>(`/playground/sessions/${id}`).then((r) => r.data),

  deleteSession: (id: string) =>
    api.delete(`/playground/sessions/${id}`),

  stopSession: (id: string) =>
    api.post(`/playground/sessions/${id}/stop`),

  // --- Skill Files ---
  listSkillFiles: (sessionId: string) =>
    api.get<{ data: SkillFile[] }>(`/playground/sessions/${sessionId}/files`).then((r) => r.data),

  getSkillFile: (sessionId: string, filePath: string) =>
    api.get<SkillFile>(`/playground/sessions/${sessionId}/files/${filePath}`).then((r) => r.data),

  updateSkillFile: (sessionId: string, filePath: string, content: string) =>
    api.put<SkillFile>(`/playground/sessions/${sessionId}/files/${filePath}`, { content }).then((r) => r.data),

  deleteSkillFile: (sessionId: string, filePath: string) =>
    api.delete(`/playground/sessions/${sessionId}/files/${filePath}`),

  // --- Skill Authoring ---
  validate: (skillMdContent: string) =>
    api.post<ValidateSkillResult>('/playground/skills/validate', { skillMdContent }).then((r) => r.data),

  scan: (skillMdContent: string) =>
    api.post<SecurityScanResult>('/playground/skills/scan', { skillMdContent }).then((r) => r.data),

  parse: (skillMdContent: string) =>
    api.post<ParsedSkill>('/playground/skills/parse', { skillMdContent }).then((r) => r.data),

  getTemplates: () =>
    api.get<{ data: SkillTemplate[] }>('/playground/templates').then((r) => r.data),

  // --- Versions ---
  listVersions: (skillId: string) =>
    api.get<{ data: SkillVersion[]; total: number }>(`/skills/${skillId}/versions`).then((r) => r.data),

  createVersion: (skillId: string, data: {
    version: string;
    skillMdContent: string;
    frontmatter?: Record<string, unknown>;
    auxiliaryFiles?: Record<string, string>;
    changeNote?: string;
  }) =>
    api.post<SkillVersion>(`/skills/${skillId}/versions`, data).then((r) => r.data),

  getVersion: (skillId: string, versionId: string) =>
    api.get<SkillVersion>(`/skills/${skillId}/versions/${versionId}`).then((r) => r.data),
};

/**
 * Shared SSE reader for streaming chat endpoints.
 */
async function* streamSSE(url: string, body: Record<string, unknown>): AsyncGenerator<{
  type: string;
  data: Record<string, unknown>;
}> {
  const baseUrl = api.defaults.baseURL ?? '/api';
  const response = await fetch(`${baseUrl}${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
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

/**
 * SSE stream for the simulator chat (right panel).
 */
export function streamChat(sessionId: string, message: string) {
  return streamSSE(`/playground/sessions/${sessionId}/chat`, { message });
}

/**
 * SSE stream for the optimizer chat (middle panel).
 */
export function streamOptimizerChat(sessionId: string, message: string) {
  return streamSSE(`/playground/sessions/${sessionId}/optimizer/chat`, { message });
}
