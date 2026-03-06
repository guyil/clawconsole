export interface AssistantSession {
  id: string;
  title: string | null;
  messages: AssistantMessage[];
  toolCallsLog: AssistantToolCallEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface AssistantMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface AssistantToolCallEntry {
  id: string;
  toolName: string;
  args: Record<string, unknown>;
  result: string;
  durationMs: number;
  timestamp: string;
}
