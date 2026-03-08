import { v4 as uuidv4 } from 'uuid';
import { buildAgent, streamAgent, closeBrowser, getAgentConfig } from '../../shared/langgraph/index.js';
import type { StreamEvent } from '../../shared/langgraph/types.js';
import { createChildLogger } from '../../shared/logger.js';
import { NotFoundError } from '../../shared/errors.js';
import { AssistantRepository } from './assistant.repository.js';
import { buildAssistantTools, type AssistantToolDeps } from './assistant.tools.js';
import type {
  AssistantSession,
  AssistantMessage,
  AssistantToolCallEntry,
  CreateAssistantSessionInput,
} from './assistant.types.js';

const log = createChildLogger('assistant-service');

const agentCfg = getAgentConfig('assistant');

export class AssistantService {
  private toolDeps: AssistantToolDeps;
  private repo: AssistantRepository;

  constructor(
    repo: AssistantRepository,
    toolDeps: AssistantToolDeps,
  ) {
    this.repo = repo;
    this.toolDeps = toolDeps;
  }

  async createSession(input: CreateAssistantSessionInput): Promise<AssistantSession> {
    return this.repo.createSession(input.title);
  }

  async getSession(id: string): Promise<AssistantSession> {
    const session = await this.repo.findById(id);
    if (!session) throw new NotFoundError('AssistantSession', id);
    return session;
  }

  async listSessions(): Promise<AssistantSession[]> {
    return this.repo.findAll();
  }

  async deleteSession(id: string): Promise<void> {
    const deleted = await this.repo.deleteSession(id);
    if (!deleted) throw new NotFoundError('AssistantSession', id);
    await closeBrowser(`assistant-${id}`);
  }

  async *chat(sessionId: string, userMessage: string): AsyncGenerator<StreamEvent> {
    const session = await this.getSession(sessionId);

    const userMsg: AssistantMessage = {
      id: uuidv4(),
      role: 'user',
      content: userMessage,
      timestamp: new Date().toISOString(),
    };
    await this.repo.appendMessage(sessionId, userMsg);

    // Auto-generate title from first user message
    if (!session.title && session.messages.length === 0) {
      const title = userMessage.slice(0, 80) + (userMessage.length > 80 ? '...' : '');
      await this.repo.updateTitle(sessionId, title);
    }

    const tools = buildAssistantTools(this.toolDeps, `assistant-${sessionId}`);
    const agent = buildAgent({
      model: agentCfg.model,
      systemPrompt: agentCfg.systemPrompt,
      tools,
      maxTokens: agentCfg.maxTokens,
      temperature: agentCfg.temperature,
    });

    const existingMessages = session.messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    let assistantContent = '';
    const toolCallStarts = new Map<string, number>();

    try {
      for await (const event of streamAgent(agent, userMessage, existingMessages, {
        agentId: 'assistant',
        sessionId,
      })) {
        yield event;

        if (event.type === 'text-delta') {
          assistantContent += event.data.content as string;
        }

        if (event.type === 'tool-call-begin') {
          toolCallStarts.set(event.data.id as string, Date.now());
        }

        if (event.type === 'tool-call-result') {
          const callId = event.data.id as string;
          const startTime = toolCallStarts.get(callId) ?? Date.now();
          const entry: AssistantToolCallEntry = {
            id: callId,
            toolName: (event.data.name as string) ?? 'unknown',
            args: {},
            result: event.data.result as string,
            durationMs: Date.now() - startTime,
            timestamp: new Date().toISOString(),
          };
          await this.repo.appendToolCallLog(sessionId, entry);
        }

        if (event.type === 'done' && assistantContent) {
          const assistantMsg: AssistantMessage = {
            id: uuidv4(),
            role: 'assistant',
            content: assistantContent,
            timestamp: new Date().toISOString(),
          };
          await this.repo.appendMessage(sessionId, assistantMsg);
        }
      }
    } catch (err) {
      log.error({ err, sessionId }, 'Assistant chat stream error');
      yield {
        type: 'error',
        data: { message: err instanceof Error ? err.message : String(err) },
      };
    }
  }
}
