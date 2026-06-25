import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ForbiddenError } from '../../shared/errors.js';
import type { ChatService } from './chat.service.js';

const CreateConversationSchema = z.object({
  machineId: z.string().min(1),
  agentId: z.string().min(1),
  title: z.string().max(255).optional(),
});

const SendMessageSchema = z.object({
  message: z.string().min(1).max(32_000),
});

export function registerChatRoutes(fastify: FastifyInstance, service: ChatService): void {
  // Chat-capable nodes (directConnect + gateway token + AES key). Developers
  // only see nodes hosting bots they are assigned to.
  fastify.get('/api/chat/nodes', async (request) => {
    const nodes = await service.listNodes(
      request.authScope ? { machineIds: request.authScope.machineIds } : undefined,
    );
    return { data: nodes };
  });

  fastify.get('/api/chat/nodes/:machineId/bots', async (request) => {
    const { machineId } = request.params as { machineId: string };
    if (request.authScope && !request.authScope.machineIds.includes(machineId)) {
      throw new ForbiddenError('Not authorized for this node');
    }
    const bots = await service.listBots(
      machineId,
      request.authScope
        ? {
            agentSlugs: request.authScope.agentKeys
              .filter(([m]) => m === machineId)
              .map(([, slug]) => slug),
          }
        : undefined,
    );
    return { data: bots };
  });

  fastify.get('/api/chat/conversations', async (request) => {
    const conversations = await service.listConversations(request.authUser?.username);
    return { data: conversations };
  });

  fastify.post('/api/chat/conversations', async (request, reply) => {
    const body = CreateConversationSchema.parse(request.body);
    if (
      request.authScope &&
      !request.authScope.agentKeys.some(([m, s]) => m === body.machineId && s === body.agentId)
    ) {
      throw new ForbiddenError('Not authorized for this bot');
    }
    const conversation = await service.createConversation({
      machineId: body.machineId,
      agentId: body.agentId,
      title: body.title,
      createdBy: request.authUser?.username,
    });
    return reply.status(201).send(conversation);
  });

  fastify.get('/api/chat/conversations/:id/messages', async (request) => {
    const { id } = request.params as { id: string };
    if (request.authScope) await service.assertConversationInScope(id, request.authScope);
    const messages = await service.getMessages(id);
    return { data: messages };
  });

  fastify.delete('/api/chat/conversations/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (request.authScope) await service.assertConversationInScope(id, request.authScope);
    await service.deleteConversation(id);
    return reply.status(204).send();
  });

  // Streamed chat turn (SSE). Mirrors the assistant module's raw-stream pattern.
  fastify.post('/api/chat/conversations/:id/messages', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = SendMessageSchema.parse(request.body);
    if (request.authScope) await service.assertConversationInScope(id, request.authScope);

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    try {
      for await (const event of service.streamChat(id, body.message)) {
        reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      reply.raw.write(`event: error\ndata: ${JSON.stringify({ message })}\n\n`);
    } finally {
      reply.raw.end();
    }
  });
}
