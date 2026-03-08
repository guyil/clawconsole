import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { SkillService } from './skill.service.js';

const CreateSkillSchema = z.object({
  skillKey: z.string().min(1).max(255),
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  scope: z.enum(['global', 'agent']).optional(),
  source: z.enum(['clawhub', 'custom', 'bundled', 'local']).optional(),
  version: z.string().max(50).optional(),
  skillMdContent: z.string().optional(),
  auxiliaryFiles: z.record(z.string()).optional(),
  requiresBins: z.array(z.string()).optional(),
  requiresEnv: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  localPath: z.string().optional(),
});

const UpdateSkillSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  version: z.string().max(50).optional(),
  skillMdContent: z.string().optional(),
  auxiliaryFiles: z.record(z.string()).optional(),
  requiresBins: z.array(z.string()).optional(),
  requiresEnv: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
});

const ReviewSkillSchema = z.object({
  action: z.enum(['approve', 'reject']),
  reviewedBy: z.string().min(1),
});

const InstallSkillSchema = z.object({
  skillCatalogId: z.string().uuid(),
  scope: z.enum(['global', 'agent']).optional(),
  configOverrides: z.record(z.unknown()).optional(),
});

const ImportSkillSchema = z.object({
  skillKey: z.string().min(1),
  scope: z.enum(['global', 'agent']).default('global'),
});

const ImportUrlSchema = z.object({
  url: z.string().url(),
});

const ImportLocalSchema = z.object({
  folderPath: z.string().min(1),
});

const DeploySkillSchema = z.object({
  scope: z.enum(['global', 'agent']).default('global'),
  agentId: z.string().uuid().optional(),
});

export function registerSkillRoutes(fastify: FastifyInstance, skillService: SkillService) {
  // --- Catalog CRUD ---

  fastify.get('/api/skills', async (request) => {
    const query = request.query as Record<string, string>;
    const skills = await skillService.listSkills({
      source: query.source as any,
      scope: query.scope as any,
      reviewStatus: query.reviewStatus as any,
      tag: query.tag || undefined,
    });
    return { data: skills, total: skills.length };
  });

  fastify.get('/api/skills/tags', async () => {
    const tags = await skillService.getAllTags();
    return { data: tags };
  });

  fastify.get('/api/skills/:skillId', async (request) => {
    const { skillId } = request.params as { skillId: string };
    return skillService.getSkill(skillId);
  });

  fastify.post('/api/skills', async (request, reply) => {
    const body = CreateSkillSchema.parse(request.body);
    const skill = await skillService.createSkill(body);
    return reply.status(201).send(skill);
  });

  fastify.patch('/api/skills/:skillId', async (request) => {
    const { skillId } = request.params as { skillId: string };
    const body = UpdateSkillSchema.parse(request.body);
    return skillService.updateSkill(skillId, body);
  });

  fastify.delete('/api/skills/:skillId', async (request, reply) => {
    const { skillId } = request.params as { skillId: string };
    await skillService.deleteSkill(skillId);
    return reply.status(204).send();
  });

  // --- Review ---

  fastify.post('/api/skills/:skillId/review', async (request) => {
    const { skillId } = request.params as { skillId: string };
    const body = ReviewSkillSchema.parse(request.body);

    if (body.action === 'approve') {
      return skillService.approveSkill(skillId, body.reviewedBy);
    }
    return skillService.rejectSkill(skillId, body.reviewedBy);
  });

  // --- Agent Skills ---

  fastify.get('/api/agents/:agentId/skills', async (request) => {
    const { agentId } = request.params as { agentId: string };
    const skills = await skillService.getAgentSkills(agentId);
    return { data: skills, total: skills.length };
  });

  fastify.post('/api/agents/:agentId/skills', async (request, reply) => {
    const { agentId } = request.params as { agentId: string };
    const body = InstallSkillSchema.parse(request.body);
    const result = await skillService.installSkillOnAgent(agentId, body);
    return reply.status(201).send(result);
  });

  fastify.delete('/api/agents/:agentId/skills/:skillCatalogId', async (request, reply) => {
    const { agentId, skillCatalogId } = request.params as { agentId: string; skillCatalogId: string };
    await skillService.uninstallSkillFromAgent(agentId, skillCatalogId);
    return reply.status(204).send();
  });

  // --- Import from URL ---

  fastify.post('/api/skills/import-url', async (request, reply) => {
    const body = ImportUrlSchema.parse(request.body);
    const skill = await skillService.importSkillFromUrl(body.url);
    return reply.status(201).send(skill);
  });

  // --- Import from local folder ---

  fastify.post('/api/skills/import-local', async (request, reply) => {
    const body = ImportLocalSchema.parse(request.body);
    const skill = await skillService.importSkillFromLocal(body.folderPath);
    return reply.status(201).send(skill);
  });

  // --- Sync local skill from disk ---

  fastify.post('/api/skills/:skillId/sync-local', async (request) => {
    const { skillId } = request.params as { skillId: string };
    return skillService.syncLocalSkill(skillId);
  });

  // --- Import / Deploy ---

  fastify.post('/api/machines/:machineId/skills/import', async (request, reply) => {
    const { machineId } = request.params as { machineId: string };
    const body = ImportSkillSchema.parse(request.body);
    const skill = await skillService.importSkillFromRemote(machineId, body.skillKey, body.scope);
    return reply.status(201).send(skill);
  });

  fastify.post('/api/skills/:skillId/deploy/:machineId', async (request) => {
    const { skillId, machineId } = request.params as { skillId: string; machineId: string };
    const body = DeploySkillSchema.parse(request.body ?? {});
    await skillService.deploySkillToMachine(skillId, machineId, body.scope, body.agentId);
    return { success: true, skillId, machineId, agentId: body.agentId };
  });
}
