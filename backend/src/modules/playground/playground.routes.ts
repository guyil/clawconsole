import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { PlaygroundService } from './playground.service.js';

const CreateSessionSchema = z.object({
  skillCatalogId: z.string().uuid().optional(),
  skillMdContent: z.string().min(1),
  agentId: z.string().optional(),
  identityFiles: z
    .array(z.object({ filename: z.string(), content: z.string() }))
    .optional(),
  config: z
    .object({
      model: z.string().optional(),
      maxToolCalls: z.number().int().min(1).max(200).optional(),
      timeoutSeconds: z.number().int().min(10).max(600).optional(),
      allowedTools: z.array(z.string()).optional(),
      systemPromptOverride: z.string().optional(),
    })
    .optional(),
});

const ChatSchema = z.object({
  message: z.string().min(1).max(10000),
});

const SkillFileSchema = z.object({
  content: z.string(),
});

const ValidateSchema = z.object({
  skillMdContent: z.string().min(1),
});

const ScanSchema = z.object({
  skillMdContent: z.string().min(1),
});

const ParseSchema = z.object({
  skillMdContent: z.string().min(1),
});

const CreateVersionSchema = z.object({
  version: z.string().min(1).max(50),
  skillMdContent: z.string().min(1),
  frontmatter: z.record(z.unknown()).optional(),
  auxiliaryFiles: z.record(z.string()).optional(),
  changeNote: z.string().optional(),
});

export function registerPlaygroundRoutes(fastify: FastifyInstance, service: PlaygroundService) {
  // --- Sessions ---

  fastify.post('/api/playground/sessions', async (request, reply) => {
    const body = CreateSessionSchema.parse(request.body);
    const session = await service.createSession(body);
    return reply.status(201).send(session);
  });

  fastify.get('/api/playground/sessions', async (request) => {
    const query = request.query as Record<string, string>;
    const sessions = await service.listSessions({
      status: query.status,
      skillCatalogId: query.skillCatalogId,
    });
    return { data: sessions, total: sessions.length };
  });

  fastify.get('/api/playground/sessions/:sessionId', async (request) => {
    const { sessionId } = request.params as { sessionId: string };
    return service.getSession(sessionId);
  });

  fastify.delete('/api/playground/sessions/:sessionId', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    await service.deleteSession(sessionId);
    return reply.status(204).send();
  });

  // Chat endpoint — returns Server-Sent Events
  fastify.post('/api/playground/sessions/:sessionId/chat', async (request, reply) => {
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

  fastify.post('/api/playground/sessions/:sessionId/stop', async (request) => {
    const { sessionId } = request.params as { sessionId: string };
    await service.stopSession(sessionId);
    return { success: true };
  });

  // --- Skill Files ---

  fastify.get('/api/playground/sessions/:sessionId/files', async (request) => {
    const { sessionId } = request.params as { sessionId: string };
    const files = await service.getSkillFiles(sessionId);
    return { data: files };
  });

  fastify.get('/api/playground/sessions/:sessionId/files/*', async (request) => {
    const { sessionId } = request.params as { sessionId: string };
    const filePath = (request.params as Record<string, string>)['*'];
    return service.getSkillFile(sessionId, filePath);
  });

  fastify.put('/api/playground/sessions/:sessionId/files/*', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const filePath = (request.params as Record<string, string>)['*'];
    const body = SkillFileSchema.parse(request.body);
    const file = await service.updateSkillFile(sessionId, filePath, body.content);
    return reply.send(file);
  });

  fastify.delete('/api/playground/sessions/:sessionId/files/*', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const filePath = (request.params as Record<string, string>)['*'];
    await service.deleteSkillFile(sessionId, filePath);
    return reply.status(204).send();
  });

  // --- Optimizer Chat (SSE) ---

  fastify.post('/api/playground/sessions/:sessionId/optimizer/chat', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const body = ChatSchema.parse(request.body);

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    try {
      for await (const event of service.optimizerChat(sessionId, body.message)) {
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

  // --- Skill Authoring ---

  fastify.post('/api/playground/skills/validate', async (request) => {
    const body = ValidateSchema.parse(request.body);
    return service.validate(body.skillMdContent);
  });

  fastify.post('/api/playground/skills/scan', async (request) => {
    const body = ScanSchema.parse(request.body);
    return service.securityScan(body.skillMdContent);
  });

  fastify.post('/api/playground/skills/parse', async (request) => {
    const body = ParseSchema.parse(request.body);
    const parsed = service.parse(body.skillMdContent);
    if (!parsed) {
      return { error: 'Failed to parse skill content' };
    }
    return parsed;
  });

  fastify.get('/api/playground/templates', async () => {
    return { data: service.getTemplates() };
  });

  // --- Skill Versions ---

  fastify.get('/api/skills/:skillId/versions', async (request) => {
    const { skillId } = request.params as { skillId: string };
    const versions = await service.listVersions(skillId);
    return { data: versions, total: versions.length };
  });

  fastify.post('/api/skills/:skillId/versions', async (request, reply) => {
    const { skillId } = request.params as { skillId: string };
    const body = CreateVersionSchema.parse(request.body);
    const version = await service.createVersion(skillId, body);
    return reply.status(201).send(version);
  });

  fastify.get('/api/skills/:skillId/versions/:versionId', async (request) => {
    const { versionId } = request.params as { versionId: string };
    return service.getVersion(versionId);
  });
}
