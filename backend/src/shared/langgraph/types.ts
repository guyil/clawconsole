export interface LangGraphAgentConfig {
  model: string;
  systemPrompt: string;
  tools: LangGraphToolDef[];
  maxToolCalls?: number;
  timeoutMs?: number;
}

export interface LangGraphToolDef {
  name: string;
  description: string;
  /** Zod schema or plain JSON Schema describing the tool's input parameters. */
  schema: Record<string, unknown>;
  /** Zod object schema for LangChain tool binding (generated automatically if not provided). */
  zodSchema?: import('zod').ZodObject<Record<string, import('zod').ZodTypeAny>>;
  handler: (args: Record<string, unknown>) => Promise<string>;
}

export interface StreamEvent {
  type: 'text-delta' | 'tool-call-begin' | 'tool-call-result' | 'done' | 'error';
  data: Record<string, unknown>;
}

export interface AgentRunResult {
  messages: AgentMessage[];
  toolCalls: AgentToolCall[];
  error?: string;
}

export interface AgentMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolCallId?: string;
  toolName?: string;
}

export interface AgentToolCall {
  id: string;
  toolName: string;
  args: Record<string, unknown>;
  result: string;
  durationMs: number;
}
