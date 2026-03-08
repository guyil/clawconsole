import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { WorkflowService } from './workflow.service.js';

// --- Zod Schemas (aligned with Lobster pipeline steps) ---

const RetryPolicySchema = z.object({
  maxRetries: z.number().int().min(0).max(10),
  backoff: z.enum(['fixed', 'exponential']).optional(),
});

const ConditionBranchSchema = z.object({
  condition: z.string().min(1),
  target: z.string().min(1),
});

const SkillNodeSchema = z.object({
  id: z.string().min(1).max(255),
  type: z.literal('skill'),
  name: z.string().min(1).max(255),
  skillRef: z.string().max(255).optional(),
  command: z.string().min(1),
  stdin: z.string().optional(),
  timeout: z.string().max(50).optional(),
  retryPolicy: RetryPolicySchema.optional(),
  onError: z.enum(['abort', 'skip', 'fallback']).optional(),
});

const ReviewNodeSchema = z.object({
  id: z.string().min(1).max(255),
  type: z.literal('review'),
  name: z.string().min(1).max(255),
  prompt: z.string().optional(),
});

const ConditionNodeSchema = z.object({
  id: z.string().min(1).max(255),
  type: z.literal('condition'),
  name: z.string().min(1).max(255),
  expression: z.string().min(1),
  branches: z.array(ConditionBranchSchema).min(1),
  default: z.string().optional(),
});

const NodeSchema = z.discriminatedUnion('type', [
  SkillNodeSchema,
  ReviewNodeSchema,
  ConditionNodeSchema,
]);

const EdgeSchema = z.object({
  source: z.string().min(1),
  target: z.string().min(1),
  condition: z.string().optional(),
});

const TriggerConfigSchema = z.object({
  type: z.enum(['message', 'schedule', 'webhook', 'manual']),
  channel: z.string().optional(),
  pattern: z.string().optional(),
  cron: z.string().optional(),
});

const CreateWorkflowSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  workflowKey: z.string().max(255).optional(),
  machineId: z.string().min(1),
  agentId: z.string().optional(),
  triggerConfig: TriggerConfigSchema,
  nodes: z.array(NodeSchema),
  edges: z.array(EdgeSchema),
  variables: z.record(z.unknown()).optional(),
  createdBy: z.string().min(1),
});

const UpdateWorkflowSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  status: z.enum(['draft', 'active', 'disabled', 'archived']).optional(),
  version: z.string().max(50).optional(),
  triggerConfig: TriggerConfigSchema.optional(),
  nodes: z.array(NodeSchema).optional(),
  edges: z.array(EdgeSchema).optional(),
  variables: z.record(z.unknown()).optional(),
  updatedBy: z.string().optional(),
});

const DeployWorkflowSchema = z.object({
  scope: z.enum(['global', 'agent']).optional(),
  agentId: z.string().optional(),
});

// --- Route Registration ---

export function registerWorkflowRoutes(
  fastify: FastifyInstance,
  workflowService: WorkflowService,
) {
  // --- Workflow CRUD ---

  fastify.get('/api/workflows', async (request) => {
    const query = request.query as Record<string, string>;
    const workflows = await workflowService.listWorkflows({
      machineId: query.machineId,
      agentId: query.agentId,
      status: query.status as 'draft' | 'active' | 'disabled' | 'archived',
    });
    return { data: workflows, total: workflows.length };
  });

  fastify.get('/api/workflows/:workflowId', async (request) => {
    const { workflowId } = request.params as { workflowId: string };
    return workflowService.getWorkflow(workflowId);
  });

  fastify.post('/api/workflows', async (request, reply) => {
    const body = CreateWorkflowSchema.parse(request.body);
    const workflow = await workflowService.createWorkflow(body);
    return reply.status(201).send(workflow);
  });

  fastify.patch('/api/workflows/:workflowId', async (request) => {
    const { workflowId } = request.params as { workflowId: string };
    const body = UpdateWorkflowSchema.parse(request.body);
    return workflowService.updateWorkflow(workflowId, body);
  });

  fastify.delete('/api/workflows/:workflowId', async (request, reply) => {
    const { workflowId } = request.params as { workflowId: string };
    await workflowService.deleteWorkflow(workflowId);
    return reply.status(204).send();
  });

  // --- Validation ---

  fastify.post('/api/workflows/:workflowId/validate', async (request) => {
    const { workflowId } = request.params as { workflowId: string };
    return workflowService.validateWorkflow(workflowId);
  });

  // --- Deploy to Machine ---

  fastify.post('/api/workflows/:workflowId/deploy/:machineId', async (request) => {
    const { workflowId, machineId } = request.params as { workflowId: string; machineId: string };
    const body = DeployWorkflowSchema.parse(request.body);
    return workflowService.deployWorkflowToMachine(
      workflowId,
      machineId,
      'system',
      (body.scope as 'global' | 'agent') ?? 'global',
      body.agentId,
    );
  });

  // --- YAML Preview ---

  fastify.get('/api/workflows/:workflowId/yaml', async (request, reply) => {
    const { workflowId } = request.params as { workflowId: string };
    const yamlContent = await workflowService.generateYaml(workflowId);
    return reply.type('text/yaml').send(yamlContent);
  });

  // --- Versions ---

  fastify.get('/api/workflows/:workflowId/versions', async (request) => {
    const { workflowId } = request.params as { workflowId: string };
    const versions = await workflowService.listVersions(workflowId);
    return { data: versions, total: versions.length };
  });
}
