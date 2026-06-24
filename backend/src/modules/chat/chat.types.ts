/** A machine that can be chatted with from the console (directConnect + /v1). */
export interface ChatNode {
  id: string;
  name: string;
  host: string;
  gatewayPort: number;
  status: 'online' | 'offline' | 'unknown';
  agentCount: number;
}

/** A bot/agent target on a node, addressable as `openclaw/<agentId>`. */
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
  createdAt: Date;
  updatedAt: Date;
}

export type ChatRole = 'user' | 'assistant';

export interface ChatMessage {
  id: string;
  conversationId: string;
  role: ChatRole;
  content: string;
  createdAt: Date;
}

export interface CreateConversationInput {
  machineId: string;
  agentId: string;
  title?: string | null;
  createdBy?: string | null;
}

/** One streamed chunk emitted by the chat service to the SSE route. */
export type ChatStreamEvent =
  | { type: 'token'; data: { content: string } }
  | { type: 'done'; data: { messageId: string; content: string } }
  | { type: 'error'; data: { message: string } };
