import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { BotConfigAgentService } from './bot-config-agent.service.js';

const ChatSchema = z.object({
  message: z.string().min(1).max(10000),
});

export function registerBotConfigAgentRoutes(
  fastify: FastifyInstance,
  service: BotConfigAgentService,
) {
  // SSE streaming chat endpoint
  fastify.post('/api/agents/:agentId/config-chat', async (request, reply) => {
    const { agentId } = request.params as { agentId: string };
    const body = ChatSchema.parse(request.body);

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    try {
      for await (const event of service.chat(agentId, body.message)) {
        const sseData = `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;
        reply.raw.write(sseData);
      }
    } catch (err) {
      const errorData = `event: error\ndata: ${JSON.stringify({ message: err instanceof Error ? err.message : String(err) })}\n\n`;
      reply.raw.write(errorData);
    } finally {
      reply.raw.end();
    }
  });

  // Get pending changes (diff data)
  fastify.get('/api/agents/:agentId/config-chat/changes', async (request) => {
    const { agentId } = request.params as { agentId: string };
    const changes = await service.getPendingChanges(agentId);
    return { data: changes, total: changes.length };
  });

  // Sync pending changes to the remote machine
  fastify.post('/api/agents/:agentId/config-chat/sync', async (request) => {
    const { agentId } = request.params as { agentId: string };
    return service.syncChanges(agentId);
  });

  // Get session info
  fastify.get('/api/agents/:agentId/config-chat/session', async (request) => {
    const { agentId } = request.params as { agentId: string };
    const info = service.getSessionInfo(agentId);
    return { data: info };
  });

  // Reset (delete) session, discarding unsaved changes
  fastify.delete('/api/agents/:agentId/config-chat/session', async (request, reply) => {
    const { agentId } = request.params as { agentId: string };
    const deleted = service.resetSession(agentId);
    return reply.status(deleted ? 204 : 404).send();
  });
}
