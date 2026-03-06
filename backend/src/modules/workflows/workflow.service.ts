import type { WorkflowRepository } from './workflow.repository.js';
import type { SkillRepository } from '../skills/skill.repository.js';
import type {
  Workflow,
  CreateWorkflowInput,
  UpdateWorkflowInput,
  WorkflowVersion,
  WorkflowRun,
  WorkflowRunNode,
  WorkflowReview,
  WorkflowStatus,
  WorkflowRunStatus,
  ReviewDecision,
  ValidationResult,
} from './workflow.types.js';
import { validateWorkflow } from './workflow.validator.js';
import { generateWorkflowYaml } from '../../generators/workflow-yaml.generator.js';
import { NotFoundError, ValidationError } from '../../shared/errors.js';
import { createChildLogger } from '../../shared/logger.js';

const log = createChildLogger('workflow-service');

export class WorkflowService {
  constructor(
    private repo: WorkflowRepository,
    private skillRepo: SkillRepository,
  ) {}

  // --- Workflow CRUD ---

  async listWorkflows(filters?: {
    machineId?: string;
    agentId?: string;
    status?: WorkflowStatus;
  }): Promise<Workflow[]> {
    return this.repo.findAll(filters);
  }

  async getWorkflow(id: string): Promise<Workflow> {
    const workflow = await this.repo.findById(id);
    if (!workflow) throw new NotFoundError('Workflow', id);
    return workflow;
  }

  async createWorkflow(input: CreateWorkflowInput): Promise<Workflow> {
    if (!input.name || input.name.trim().length === 0) {
      throw new ValidationError('Workflow name cannot be empty');
    }
    if (!input.machineId || input.machineId.trim().length === 0) {
      throw new ValidationError('Machine ID is required');
    }
    if (!input.triggerConfig) {
      throw new ValidationError('Trigger configuration is required');
    }
    if (!input.nodes || input.nodes.length === 0) {
      throw new ValidationError('Workflow must have at least one node');
    }

    const existing = await this.repo.findByName(input.name, input.machineId);
    if (existing) {
      throw new ValidationError(`Workflow with name "${input.name}" already exists on this machine`);
    }

    const workflow = await this.repo.create(input);
    log.info({ workflowId: workflow.id, name: workflow.name }, 'Workflow created');
    return workflow;
  }

  async updateWorkflow(id: string, input: UpdateWorkflowInput): Promise<Workflow> {
    await this.getWorkflow(id);
    const updated = await this.repo.update(id, input);
    if (!updated) throw new NotFoundError('Workflow', id);
    log.info({ workflowId: id }, 'Workflow updated');
    return updated;
  }

  async deleteWorkflow(id: string): Promise<void> {
    const workflow = await this.getWorkflow(id);
    if (workflow.status === 'active') {
      throw new ValidationError('Cannot delete an active workflow. Disable it first.');
    }
    const deleted = await this.repo.delete(id);
    if (!deleted) throw new NotFoundError('Workflow', id);
    log.info({ workflowId: id, name: workflow.name }, 'Workflow deleted');
  }

  // --- Validation ---

  async validateWorkflow(id: string): Promise<ValidationResult> {
    const workflow = await this.getWorkflow(id);

    // Get approved skills for reference checking
    const approvedSkills = await this.skillRepo.findAll({ reviewStatus: 'approved' });
    const approvedSkillKeys = new Set(approvedSkills.map((s) => s.skillKey));

    return validateWorkflow(workflow.nodes, workflow.edges, approvedSkillKeys);
  }

  // --- YAML Generation ---

  async generateYaml(id: string): Promise<string> {
    const workflow = await this.getWorkflow(id);
    return generateWorkflowYaml(workflow);
  }

  // --- Deploy ---

  async deployWorkflow(id: string, deployedBy: string): Promise<Workflow> {
    const workflow = await this.getWorkflow(id);

    // Validate before deploying
    const validation = await this.validateWorkflow(id);
    if (!validation.valid) {
      throw new ValidationError('Workflow validation failed', {
        errors: validation.errors,
      });
    }

    // Create version snapshot
    const nextVersion = incrementVersion(workflow.version);
    await this.repo.createVersion({
      workflowId: id,
      version: nextVersion,
      snapshotJson: {
        name: workflow.name,
        description: workflow.description,
        triggerConfig: workflow.triggerConfig,
        nodes: workflow.nodes,
        edges: workflow.edges,
        variables: workflow.variables,
      },
      createdBy: deployedBy,
    });

    // Update workflow status
    const updated = await this.repo.update(id, {
      status: 'active',
      version: nextVersion,
      deployedAt: new Date(),
      updatedBy: deployedBy,
    });

    log.info({ workflowId: id, version: nextVersion, deployedBy }, 'Workflow deployed');
    return updated!;
  }

  // --- Versions ---

  async listVersions(workflowId: string): Promise<WorkflowVersion[]> {
    await this.getWorkflow(workflowId);
    return this.repo.findVersions(workflowId);
  }

  // --- Workflow Runs ---

  async listRuns(filters?: {
    workflowId?: string;
    machineId?: string;
    status?: WorkflowRunStatus;
  }): Promise<WorkflowRun[]> {
    return this.repo.findRuns(filters);
  }

  async getRun(id: string): Promise<WorkflowRun> {
    const run = await this.repo.findRunById(id);
    if (!run) throw new NotFoundError('WorkflowRun', id);
    return run;
  }

  async getRunNodes(runId: string): Promise<WorkflowRunNode[]> {
    await this.getRun(runId);
    return this.repo.findRunNodes(runId);
  }

  async abortRun(id: string): Promise<WorkflowRun> {
    const run = await this.getRun(id);
    if (run.status === 'completed' || run.status === 'aborted') {
      throw new ValidationError(`Cannot abort a run with status '${run.status}'`);
    }
    const updated = await this.repo.updateRunStatus(id, 'aborted');
    log.info({ runId: id }, 'Workflow run aborted');
    return updated!;
  }

  // --- Reviews ---

  async listPendingReviews(userId?: string): Promise<WorkflowReview[]> {
    return this.repo.findPendingReviews(userId);
  }

  async getReview(runId: string, nodeId: string): Promise<WorkflowReview> {
    const review = await this.repo.findReviewByRunAndNode(runId, nodeId);
    if (!review) throw new NotFoundError('WorkflowReview', `${runId}/${nodeId}`);
    return review;
  }

  async submitReviewDecision(
    runId: string,
    nodeId: string,
    decision: ReviewDecision,
    decidedBy: string,
    comments?: string,
  ): Promise<WorkflowReview> {
    const review = await this.getReview(runId, nodeId);

    if (review.status !== 'pending') {
      throw new ValidationError(`Review is already in status '${review.status}'`);
    }

    const updated = await this.repo.updateReviewDecision(
      review.id,
      decision,
      decidedBy,
      comments,
    );

    log.info({ runId, nodeId, decision, decidedBy }, 'Review decision submitted');
    return updated!;
  }

  async checkExpiredReviews(): Promise<WorkflowReview[]> {
    const expired = await this.repo.findExpiredReviews();
    const results: WorkflowReview[] = [];

    for (const review of expired) {
      const updated = await this.repo.updateReviewStatus(review.id, 'expired');
      if (updated) {
        results.push(updated);
        log.info({ reviewId: review.id, runId: review.runId, nodeId: review.nodeId }, 'Review expired');
      }
    }

    return results;
  }
}

/**
 * Increment a semver-like version string.
 * "1.0.0" → "1.0.1", "1.0.9" → "1.0.10"
 */
function incrementVersion(version: string): string {
  const parts = version.split('.').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return '1.0.1';
  parts[2]++;
  return parts.join('.');
}
