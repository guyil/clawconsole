import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AssistantService } from './assistant.service.js';

const ChatSchema = z.object({
  message: z.string().min(1).max(10000),
});

const CreateSessionSchema = z.object({
  title: z.string().max(255).optional(),
});

export function registerAssistantRoutes(
  fastify: FastifyInstance,
  service: AssistantService,
) {
  // List all sessions
  fastify.get('/api/assistant/sessions', async () => {
    const sessions = await service.listSessions();
    return { data: sessions, total: sessions.length };
  });

  // Create a new session
  fastify.post('/api/assistant/sessions', async (request) => {
    const body = CreateSessionSchema.parse(request.body ?? {});
    const session = await service.createSession({ title: body.title });
    return session;
  });

  // Get session details
  fastify.get('/api/assistant/sessions/:sessionId', async (request) => {
    const { sessionId } = request.params as { sessionId: string };
    return service.getSession(sessionId);
  });

  // Delete session
  fastify.delete('/api/assistant/sessions/:sessionId', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    await service.deleteSession(sessionId);
    return reply.status(204).send();
  });

  // SSE streaming chat endpoint
  fastify.post('/api/assistant/sessions/:sessionId/chat', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const body = ChatSchema.parse(request.body);

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    try {
      for await (const event of service.chat(sessionId, body.message)) {
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
}
