import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { SummaryService } from './summary.service.js';
import type { AgentRepository } from '../agents/agent.repository.js';
import { AppError } from '../../shared/errors.js';
import { isAgentInScope } from '../auth/authz.js';
import type { GenerationTarget } from './summary.types.js';

const ListQuerySchema = z.object({
  machineId: z.string().optional(),
  agentId: z.string().optional(),
  agentUuid: z.string().optional(),
  trigger: z.enum(['scheduled', 'manual']).optional(),
  status: z.enum(['success', 'empty', 'failed']).optional(),
  since: z.string().optional(),
  until: z.string().optional(),
  limit: z.coerce.number().int().positive().max(500).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});

const PushToggleSchema = z.object({
  enabled: z.boolean(),
});

const GenerateSchema = z.object({
  agentUuids: z.array(z.string().uuid()).optional(),
  machineId: z.string().optional(),
  agentId: z.string().optional(),
  days: z.number().int().min(1).max(14),
  forcePush: z.boolean().optional(),
});

export function registerSummaryRoutes(
  fastify: FastifyInstance,
  service: SummaryService,
  agentRepo: AgentRepository,
): void {
  fastify.get('/api/summaries/status', async () => {
    return {
      geminiConfigured: service.isGeminiConfigured(),
      feishuConfigured: service.isFeishuConfigured(),
      feishuHint: service.isFeishuConfigured() ? null : service.getFeishuHint(),
      model: service.getModelName(),
      windowHours: service.getWindowHours(),
    };
  });

  fastify.get('/api/summaries', async (request) => {
    const q = ListQuerySchema.parse(request.query);
    const filters = {
      machineId: q.machineId,
      agentId: q.agentId,
      agentUuid: q.agentUuid,
      trigger: q.trigger,
      status: q.status,
      since: q.since ? new Date(q.since) : undefined,
      until: q.until ? new Date(q.until) : undefined,
      limit: q.limit,
      offset: q.offset,
      allowedAgentUuids: request.authScope?.agentUuids,
    };
    const { limit: _l, offset: _o, ...countFilters } = filters;
    void _l; void _o;
    const [data, total] = await Promise.all([
      service.listSummaries(filters),
      service.countSummaries(countFilters),
    ]);
    return { data, total };
  });

  fastify.get<{ Params: { id: string } }>('/api/summaries/:id', async (request) => {
    const id = parseInt(request.params.id, 10);
    if (Number.isNaN(id)) throw new AppError('Invalid id', 'VALIDATION_ERROR', 400);
    const row = await service.getSummary(id);
    if (!row) throw new AppError('Summary not found', 'NOT_FOUND', 404);
    if (request.authScope && (!row.agentUuid || !isAgentInScope(request.authScope, row.agentUuid))) {
      throw new AppError('Forbidden', 'FORBIDDEN', 403);
    }
    return row;
  });

  fastify.get('/api/summaries/push-config', async () => {
    const data = await service.listPushConfig();
    return { data };
  });

  fastify.put<{
    Params: { agentUuid: string };
    Body: { enabled: boolean };
  }>('/api/summaries/push-config/:agentUuid', async (request) => {
    const body = PushToggleSchema.parse(request.body);
    const ok = await service.setPushEnabled(request.params.agentUuid, body.enabled);
    if (!ok) throw new AppError('Agent not found', 'NOT_FOUND', 404);
    return { ok: true, enabled: body.enabled };
  });

  /**
   * Manual trigger. Lets the user pick any subset of bots and a 1-14d
   * lookback. Push to Feishu defaults to true so manual runs double as a
   * "catch up" notification; can be disabled per-request.
   */
  fastify.post('/api/summaries/generate', async (request, reply) => {
    if (!service.isGeminiConfigured()) {
      reply.code(503);
      return { error: 'GEMINI_API_KEY not configured' };
    }
    const body = GenerateSchema.parse(request.body);

    const targets: GenerationTarget[] = [];
    if (body.agentUuids && body.agentUuids.length > 0) {
      for (const uuid of body.agentUuids) {
        const agent = await agentRepo.findById(uuid);
        if (!agent) continue;
        targets.push({
          machineId: agent.machineId,
          agentId: agent.agentId,
          agentUuid: agent.id,
          agentName: agent.name,
        });
      }
    } else if (body.machineId && body.agentId) {
      const agent = await agentRepo.findByMachineAndAgentId(body.machineId, body.agentId);
      targets.push({
        machineId: body.machineId,
        agentId: body.agentId,
        agentUuid: agent?.id ?? null,
        agentName: agent?.name ?? null,
      });
    } else {
      throw new AppError(
        'Must provide either agentUuids[] or (machineId + agentId)',
        'VALIDATION_ERROR',
        400,
      );
    }

    if (targets.length === 0) {
      throw new AppError('No valid bot targets resolved', 'VALIDATION_ERROR', 400);
    }

    const results = await service.generateManual({
      targets,
      days: body.days,
      forcePush: body.forcePush,
    });

    return { results };
  });
}
