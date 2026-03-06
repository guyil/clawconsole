import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { WorkflowService } from './workflow.service.js';

// --- Zod Schemas ---

const ReviewerRefSchema = z.object({
  userId: z.string().optional(),
  role: z.string().optional(),
  group: z.string().optional(),
});

const EscalationSchema = z.object({
  action: z.enum(['notify', 'auto_approve', 'auto_reject', 'abort']),
  target: z.array(ReviewerRefSchema).min(1),
  message: z.string().optional(),
});

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
  skillRef: z.string().min(1).max(255),
  input: z.record(z.string()).optional(),
  output: z.string().min(1).max(255),
  timeout: z.string().max(50).optional(),
  retryPolicy: RetryPolicySchema.optional(),
  onError: z.enum(['abort', 'skip', 'fallback']).optional(),
});

const ReviewNodeSchema = z.object({
  id: z.string().min(1).max(255),
  type: z.literal('review'),
  name: z.string().min(1).max(255),
  reviewers: z.array(ReviewerRefSchema).min(1),
  policy: z.enum(['any', 'all']),
  timeout: z.string().max(50).optional(),
  escalation: EscalationSchema.optional(),
  payload: z.record(z.string()).optional(),
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
  machineId: z.string().min(1),
  agentId: z.string().optional(),
  triggerConfig: TriggerConfigSchema,
  nodes: z.array(NodeSchema).min(1),
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
  deployedBy: z.string().min(1),
});

const ReviewDecisionSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  decidedBy: z.string().min(1),
  comments: z.string().optional(),
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
      status: query.status as any,
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

  // --- Deploy ---

  fastify.post('/api/workflows/:workflowId/deploy', async (request) => {
    const { workflowId } = request.params as { workflowId: string };
    const body = DeployWorkflowSchema.parse(request.body);
    return workflowService.deployWorkflow(workflowId, body.deployedBy);
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

  // --- Workflow Runs ---

  fastify.get('/api/workflows/:workflowId/runs', async (request) => {
    const { workflowId } = request.params as { workflowId: string };
    const query = request.query as Record<string, string>;
    const runs = await workflowService.listRuns({
      workflowId,
      status: query.status as any,
    });
    return { data: runs, total: runs.length };
  });

  fastify.get('/api/workflow-runs/:runId', async (request) => {
    const { runId } = request.params as { runId: string };
    return workflowService.getRun(runId);
  });

  fastify.get('/api/workflow-runs/:runId/nodes', async (request) => {
    const { runId } = request.params as { runId: string };
    const nodes = await workflowService.getRunNodes(runId);
    return { data: nodes, total: nodes.length };
  });

  fastify.post('/api/workflow-runs/:runId/abort', async (request) => {
    const { runId } = request.params as { runId: string };
    return workflowService.abortRun(runId);
  });

  // --- Reviews ---

  fastify.get('/api/reviews/pending', async (request) => {
    const query = request.query as Record<string, string>;
    const reviews = await workflowService.listPendingReviews(query.userId);
    return { data: reviews, total: reviews.length };
  });

  fastify.get('/api/reviews/:runId/:nodeId', async (request) => {
    const { runId, nodeId } = request.params as { runId: string; nodeId: string };
    return workflowService.getReview(runId, nodeId);
  });

  fastify.post('/api/reviews/:runId/:nodeId/decide', async (request) => {
    const { runId, nodeId } = request.params as { runId: string; nodeId: string };
    const body = ReviewDecisionSchema.parse(request.body);
    return workflowService.submitReviewDecision(
      runId,
      nodeId,
      body.decision,
      body.decidedBy,
      body.comments,
    );
  });
}
