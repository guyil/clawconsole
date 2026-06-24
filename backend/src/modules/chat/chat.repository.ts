import { v4 as uuidv4 } from 'uuid';
import { getDb, type Knex } from '../../shared/db.js';
import type {
  ChatConversation,
  ChatMessage,
  ChatRole,
  CreateConversationInput,
} from './chat.types.js';

export class ChatRepository {
  private get db(): Knex {
    return getDb();
  }

  async createConversation(input: CreateConversationInput): Promise<ChatConversation> {
    const id = uuidv4();
    const now = new Date();
    await this.db('chat_conversations').insert({
      id,
      machine_id: input.machineId,
      agent_id: input.agentId,
      title: input.title ?? null,
      created_by: input.createdBy ?? null,
      created_at: now,
      updated_at: now,
    });
    return (await this.findById(id))!;
  }

  async findById(id: string): Promise<ChatConversation | null> {
    const row = await this.db('chat_conversations').where('id', id).first();
    return row ? this.toConversation(row) : null;
  }

  /** List conversations, newest activity first. `createdBy` scopes to one user. */
  async listConversations(filters?: { createdBy?: string }): Promise<ChatConversation[]> {
    let query = this.db('chat_conversations').select('*');
    if (filters?.createdBy) {
      query = query.where('created_by', filters.createdBy);
    }
    const rows = await query.orderBy('updated_at', 'desc').limit(200);
    return rows.map(this.toConversation);
  }

  async updateTitle(id: string, title: string): Promise<void> {
    await this.db('chat_conversations')
      .where('id', id)
      .update({ title, updated_at: new Date() });
  }

  async touch(id: string): Promise<void> {
    await this.db('chat_conversations').where('id', id).update({ updated_at: new Date() });
  }

  async deleteConversation(id: string): Promise<boolean> {
    await this.db('chat_messages').where('conversation_id', id).delete();
    const deleted = await this.db('chat_conversations').where('id', id).delete();
    return deleted > 0;
  }

  async appendMessage(
    conversationId: string,
    role: ChatRole,
    content: string,
  ): Promise<ChatMessage> {
    const id = uuidv4();
    const now = new Date();
    await this.db('chat_messages').insert({
      id,
      conversation_id: conversationId,
      role,
      content,
      created_at: now,
    });
    return { id, conversationId, role, content, createdAt: now };
  }

  async listMessages(conversationId: string): Promise<ChatMessage[]> {
    const rows = await this.db('chat_messages')
      .where('conversation_id', conversationId)
      .orderBy('created_at', 'asc');
    return rows.map(this.toMessage);
  }

  private toConversation(row: Record<string, unknown>): ChatConversation {
    return {
      id: row.id as string,
      machineId: row.machine_id as string,
      agentId: row.agent_id as string,
      title: (row.title as string | null) ?? null,
      createdBy: (row.created_by as string | null) ?? null,
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    };
  }

  private toMessage(row: Record<string, unknown>): ChatMessage {
    return {
      id: row.id as string,
      conversationId: row.conversation_id as string,
      role: row.role as ChatRole,
      content: row.content as string,
      createdAt: new Date(row.created_at as string),
    };
  }
}
