import { v4 as uuidv4 } from 'uuid';
import { buildAgent, streamAgent } from '../../shared/langgraph/index.js';
import type { StreamEvent } from '../../shared/langgraph/types.js';
import { createChildLogger } from '../../shared/logger.js';
import { NotFoundError } from '../../shared/errors.js';
import { config } from '../../config/index.js';
import { AssistantRepository } from './assistant.repository.js';
import { buildAssistantTools, type AssistantToolDeps } from './assistant.tools.js';
import type {
  AssistantSession,
  AssistantMessage,
  AssistantToolCallEntry,
  CreateAssistantSessionInput,
} from './assistant.types.js';

const log = createChildLogger('assistant-service');

const SYSTEM_PROMPT = `You are an AI operations assistant for the ClawConsole platform — an enterprise management console for OpenClaw AI Agents deployed across multiple machines connected via Tailscale.

## Your Capabilities

You can:
1. **Query cluster state** — list machines, agents, sync history, and run health checks
2. **Execute SSH commands** — run any shell command on any managed machine
3. **Fetch web content** — download scripts or check endpoints

## Workflow Guidelines

1. **Discover first**: If the user doesn't specify which machine to operate on, use \`list_machines\` to see what's available, then ask or infer the target.
2. **Explain before acting**: Briefly describe what command you plan to run and why before executing SSH commands.
3. **Report results clearly**: Show command output in a readable format. Summarize success/failure.
4. **Handle errors gracefully**: If a command fails, explain what went wrong and suggest alternatives.
5. **Chain commands when needed**: For multi-step tasks (e.g., install a package), run commands sequentially and check each result.

## Safety Notes

- You have unrestricted SSH access. Exercise care with destructive commands (rm -rf, reboot, etc.).
- For package installation, prefer the system's package manager (apt, yum, brew, etc.).
- When modifying system services, check current status before making changes.

## Context

You are operating within ClawConsole which manages OpenClaw AI agents. Each machine runs OpenClaw with config files under \`~/.openclaw/\`. The machines are connected via Tailscale WireGuard tunnels.

Respond in the same language as the user's message.`;

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

    const tools = buildAssistantTools(this.toolDeps);
    const agent = buildAgent({
      model: config.playground.defaultModel,
      systemPrompt: SYSTEM_PROMPT,
      tools,
    });

    const existingMessages = session.messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    let assistantContent = '';
    const toolCallStarts = new Map<string, number>();

    try {
      for await (const event of streamAgent(agent, userMessage, existingMessages)) {
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
