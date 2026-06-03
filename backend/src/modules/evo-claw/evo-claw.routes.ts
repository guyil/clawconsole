import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { EvoClawService } from './evo-claw.service.js';

const TriggerSchema = z.object({
  machineId: z.string().min(1),
});

const UpdateRuleSchema = z.object({
  content: z.string().min(1).optional(),
  status: z.enum(['active', 'deprecated', 'merged', 'superseded']).optional(),
  targetSection: z.string().optional(),
});

const UpdateCaseSchema = z.object({
  scenario: z.string().min(1).optional(),
  correctApproach: z.string().min(1).optional(),
  status: z.enum(['active', 'deprecated', 'merged']).optional(),
});

export function registerEvoClawRoutes(
  fastify: FastifyInstance,
  ecaService: EvoClawService,
): void {
  // ─── Trigger Evolution ──────────────────────────────────────────

  fastify.post<{
    Params: { agentId: string };
    Body: { machineId: string };
  }>('/api/agents/:agentId/evo/trigger', async (req, reply) => {
    const body = TriggerSchema.parse(req.body);
    const { agentId } = req.params;

    const run = await ecaService.triggerEvolution(body.machineId, agentId, 'manual');
    return reply.status(202).send(run);
  });

  // ─── List Runs ──────────────────────────────────────────────────

  fastify.get<{
    Params: { agentId: string };
    Querystring: { machineId?: string; status?: string; limit?: string; offset?: string };
  }>('/api/agents/:agentId/evo/runs', async (req, reply) => {
    const { agentId } = req.params;
    const { machineId, status, limit, offset } = req.query;

    const runs = await ecaService.listRuns({
      agentId,
      machineId,
      status: status as import('./evo-claw.types.js').EvoRunStatus | undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
    return reply.send(runs);
  });

  // ─── Get Run Detail ─────────────────────────────────────────────

  fastify.get<{
    Params: { agentId: string; runId: string };
  }>('/api/agents/:agentId/evo/runs/:runId', async (req, reply) => {
    const runId = parseInt(req.params.runId, 10);
    const run = await ecaService.getRunDetail(runId);
    if (!run) return reply.status(404).send({ error: 'Run not found' });

    const signals = await ecaService.getRunSignals(runId);
    return reply.send({ ...run, signals });
  });

  // ─── List Rules ─────────────────────────────────────────────────

  fastify.get<{
    Params: { agentId: string };
    Querystring: {
      machineId?: string;
      status?: string;
      targetFile?: string;
      limit?: string;
      offset?: string;
    };
  }>('/api/agents/:agentId/evo/rules', async (req, reply) => {
    const { agentId } = req.params;
    const { machineId, status, targetFile, limit, offset } = req.query;

    const rules = await ecaService.listRules({
      agentId,
      machineId,
      status: status as import('./evo-claw.types.js').RuleStatus | undefined,
      targetFile: targetFile as import('./evo-claw.types.js').EvoTargetFile | undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
    return reply.send(rules);
  });

  // ─── Update Rule ────────────────────────────────────────────────

  fastify.patch<{
    Params: { agentId: string; ruleId: string };
    Body: z.infer<typeof UpdateRuleSchema>;
  }>('/api/agents/:agentId/evo/rules/:ruleId', async (req, reply) => {
    const body = UpdateRuleSchema.parse(req.body);
    const ruleId = parseInt(req.params.ruleId, 10);
    await ecaService.updateRule(ruleId, body);
    return reply.send({ ok: true });
  });

  // ─── Deprecate Rule ─────────────────────────────────────────────

  fastify.delete<{
    Params: { agentId: string; ruleId: string };
  }>('/api/agents/:agentId/evo/rules/:ruleId', async (req, reply) => {
    const ruleId = parseInt(req.params.ruleId, 10);
    await ecaService.deprecateRule(ruleId);
    return reply.send({ ok: true });
  });

  // ─── List Cases ─────────────────────────────────────────────────

  fastify.get<{
    Params: { agentId: string };
    Querystring: {
      machineId?: string;
      status?: string;
      limit?: string;
      offset?: string;
    };
  }>('/api/agents/:agentId/evo/cases', async (req, reply) => {
    const { agentId } = req.params;
    const { machineId, status, limit, offset } = req.query;

    const cases = await ecaService.listCases({
      agentId,
      machineId,
      status: status as import('./evo-claw.types.js').CaseStatus | undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
    return reply.send(cases);
  });

  // ─── Update Case ────────────────────────────────────────────────

  fastify.patch<{
    Params: { agentId: string; caseId: string };
    Body: z.infer<typeof UpdateCaseSchema>;
  }>('/api/agents/:agentId/evo/cases/:caseId', async (req, reply) => {
    const body = UpdateCaseSchema.parse(req.body);
    const caseId = parseInt(req.params.caseId, 10);
    await ecaService.updateCase(caseId, body);
    return reply.send({ ok: true });
  });

  // ─── Delete Case ────────────────────────────────────────────────

  fastify.delete<{
    Params: { agentId: string; caseId: string };
  }>('/api/agents/:agentId/evo/cases/:caseId', async (req, reply) => {
    const caseId = parseInt(req.params.caseId, 10);
    await ecaService.deprecateCase(caseId);
    return reply.send({ ok: true });
  });
}
