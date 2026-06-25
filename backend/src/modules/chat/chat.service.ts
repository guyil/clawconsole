import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import type { MachineRepository } from '../machines/machine.repository.js';
import type { AgentRepository } from '../agents/agent.repository.js';
import type { Machine } from '../machines/machine.types.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../../shared/errors.js';
import { createChildLogger } from '../../shared/logger.js';
import { config } from '../../config/index.js';
import type { ChatRepository } from './chat.repository.js';
import type {
  ChatBot,
  ChatConversation,
  ChatMessage,
  ChatNode,
  ChatStreamEvent,
} from './chat.types.js';

const log = createChildLogger('chat-service');

interface ChatServiceDeps {
  machineRepo: MachineRepository;
  agentRepo: AgentRepository;
}

/**
 * Mint an ERP X-AUTH-TOKEN exactly as the openclaw fork's `erp-auth-token.ts`
 * expects to decrypt it: AES-256-CBC, key = sha256(rawKey), random 16-byte IV
 * prepended, base64(iv + ciphertext). Payload carries the fixed console
 * operator identity and an issue timestamp (5-minute TTL on the gateway side).
 */
function mintErpAuthToken(aesKey: string, userId: string, userName: string): string {
  const key = createHash('sha256').update(aesKey.trim(), 'utf8').digest();
  const payload = JSON.stringify({
    user_id: /^\d+$/.test(userId) ? Number(userId) : userId,
    user_name: userName,
    timestamp: Math.floor(Date.now() / 1000),
  });
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-cbc', key, iv);
  const encrypted = Buffer.concat([cipher.update(Buffer.from(payload, 'utf8')), cipher.final()]);
  return Buffer.concat([iv, encrypted]).toString('base64');
}

export class ChatService {
  constructor(
    private repo: ChatRepository,
    private deps: ChatServiceDeps,
  ) {}

  /**
   * Machines that can be chatted with: any machine with a `gatewayToken` (the
   * HTTP bearer for its gateway). Works for both directConnect (public-IP)
   * nodes and Tailscale-monitored machines (reached over the tailnet hostname).
   * `gatewayAesKey` is optional — only erp gateways need it (to mint the
   * X-AUTH-TOKEN); standard openclaw gateways are chatted without it.
   */
  async listNodes(scope?: { machineIds: string[] }): Promise<ChatNode[]> {
    const machines = await this.deps.machineRepo.findAll();
    return machines
      .filter((m) => Boolean(m.gatewayToken))
      .filter((m) => !scope || scope.machineIds.includes(m.id))
      .map((m) => ({
        id: m.id,
        name: m.name,
        host: m.tailscaleHostname,
        gatewayPort: m.gatewayPort ?? config.gateway.defaultPort,
        status: m.status,
        agentCount: m.agentCount,
      }));
  }

  /**
   * Bots on a node. Developers pass their assigned slugs for this machine so
   * the dropdown only offers bots they're allowed to chat with; admins (no
   * scope) see every bot on the node.
   */
  async listBots(machineId: string, scope?: { agentSlugs: string[] }): Promise<ChatBot[]> {
    const agents = await this.deps.agentRepo.findByMachineId(machineId);
    return agents
      .filter((a) => !scope || scope.agentSlugs.includes(a.agentId))
      .map((a) => ({ agentId: a.agentId, name: a.name }));
  }

  /**
   * Guard the conversation-id routes (read messages, send a turn, delete) for
   * developers: the conversation's target bot must be in their assigned scope.
   * Stops a developer from reaching an unassigned bot via a guessed/leaked
   * conversation id. Admins are unrestricted and skip this.
   */
  async assertConversationInScope(
    conversationId: string,
    scope: { agentKeys: Array<[string, string]> },
  ): Promise<void> {
    const conv = await this.repo.findById(conversationId);
    if (!conv) throw new NotFoundError('Conversation', conversationId);
    const inScope = scope.agentKeys.some(
      ([m, s]) => m === conv.machineId && s === conv.agentId,
    );
    if (!inScope) throw new ForbiddenError('Not authorized for this conversation');
  }

  async createConversation(input: {
    machineId: string;
    agentId: string;
    title?: string;
    createdBy?: string;
  }): Promise<ChatConversation> {
    const machine = await this.deps.machineRepo.findById(input.machineId);
    if (!machine) throw new NotFoundError('Machine', input.machineId);
    this.assertChatCapable(machine);
    return this.repo.createConversation({
      machineId: input.machineId,
      agentId: input.agentId,
      title: input.title ?? null,
      createdBy: input.createdBy ?? null,
    });
  }

  async listConversations(createdBy?: string): Promise<ChatConversation[]> {
    return this.repo.listConversations(createdBy ? { createdBy } : undefined);
  }

  async getMessages(conversationId: string): Promise<ChatMessage[]> {
    const conv = await this.repo.findById(conversationId);
    if (!conv) throw new NotFoundError('Conversation', conversationId);
    return this.repo.listMessages(conversationId);
  }

  async deleteConversation(conversationId: string): Promise<void> {
    const ok = await this.repo.deleteConversation(conversationId);
    if (!ok) throw new NotFoundError('Conversation', conversationId);
  }

  private assertChatCapable(machine: Machine): void {
    if (!machine.gatewayToken) {
      throw new ValidationError(
        `Machine ${machine.name} is not chat-capable (needs a gatewayToken)`,
      );
    }
  }

  /**
   * Stream a chat turn: persist the user message, mint an X-AUTH-TOKEN for the
   * fixed operator identity, proxy to the machine gateway's OpenAI-compatible
   * `/v1/chat/completions` with `model = openclaw/<agentId>` and the
   * conversation id as the openclaw session key (for multi-turn continuity),
   * relay tokens to the caller, then persist the assistant reply.
   */
  async *streamChat(
    conversationId: string,
    userMessage: string,
  ): AsyncGenerator<ChatStreamEvent> {
    const conv = await this.repo.findById(conversationId);
    if (!conv) throw new NotFoundError('Conversation', conversationId);
    const machine = await this.deps.machineRepo.findById(conv.machineId);
    if (!machine) throw new NotFoundError('Machine', conv.machineId);
    this.assertChatCapable(machine);

    await this.repo.appendMessage(conversationId, 'user', userMessage);
    if (!conv.title) {
      await this.repo.updateTitle(conversationId, userMessage.slice(0, 60));
    } else {
      await this.repo.touch(conversationId);
    }

    // Carry multi-turn context explicitly in the OpenAI `messages` array (last
    // N turns). We deliberately do NOT send `x-openclaw-session-key`: a fresh
    // gateway session key binds to the DEFAULT agent and overrides the `model`
    // agent target, so the wrong bot would answer. Sending history as messages
    // keeps both correct agent routing (via `model`) and conversation context.
    const history = await this.repo.listMessages(conversationId);
    const messages = history
      .slice(-40)
      .map((m) => ({ role: m.role, content: m.content }));

    const port = machine.gatewayPort ?? config.gateway.defaultPort;
    const url = `http://${machine.tailscaleHostname}:${port}/v1/chat/completions`;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${machine.gatewayToken}`,
      'Content-Type': 'application/json',
    };
    // erp gateways only: mint + present the X-AUTH-TOKEN so the 数据中台 scopes
    // data. Per-bot data identity (if configured) overrides the global operator.
    // Standard openclaw gateways have no AES key and need no X-AUTH.
    if (machine.gatewayAesKey) {
      const agent = await this.deps.agentRepo.findByMachineAndAgentId(conv.machineId, conv.agentId);
      const dataUserId = agent?.dataUserId?.trim() || config.chat.operatorUserId;
      const dataUserName = agent?.dataUserName?.trim() || config.chat.operatorUserName;
      headers['X-AUTH-TOKEN'] = mintErpAuthToken(machine.gatewayAesKey, dataUserId, dataUserName);
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: `openclaw/${conv.agentId}`,
          messages,
          stream: true,
        }),
      });
    } catch (err) {
      const message = `gateway unreachable: ${(err as Error).message}`;
      log.warn({ conversationId, err: message }, 'chat proxy request failed');
      yield { type: 'error', data: { message } };
      return;
    }

    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => '');
      const message = `gateway returned ${response.status}${text ? `: ${text.slice(0, 200)}` : ''}`;
      log.warn({ conversationId, status: response.status }, 'chat proxy non-2xx');
      yield { type: 'error', data: { message } };
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let full = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === '[DONE]') continue;
          let json: { choices?: Array<{ delta?: { content?: string } }> };
          try {
            json = JSON.parse(payload);
          } catch {
            continue;
          }
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) {
            full += delta;
            yield { type: 'token', data: { content: delta } };
          }
        }
      }
    } catch (err) {
      const message = `stream interrupted: ${(err as Error).message}`;
      log.warn({ conversationId, err: message }, 'chat stream error');
      if (full) {
        const saved = await this.repo.appendMessage(conversationId, 'assistant', full);
        yield { type: 'done', data: { messageId: saved.id, content: full } };
      } else {
        yield { type: 'error', data: { message } };
      }
      return;
    }

    const saved = await this.repo.appendMessage(conversationId, 'assistant', full);
    await this.repo.touch(conversationId);
    yield { type: 'done', data: { messageId: saved.id, content: full } };
  }
}
