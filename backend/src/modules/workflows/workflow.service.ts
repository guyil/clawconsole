import type { WorkflowRepository } from './workflow.repository.js';
import type { SkillRepository } from '../skills/skill.repository.js';
import type { MachineService } from '../machines/machine.service.js';
import type { AgentRepository } from '../agents/agent.repository.js';
import type { FileTransfer } from '../../transport/file-transfer.js';
import type {
  Workflow,
  CreateWorkflowInput,
  UpdateWorkflowInput,
  WorkflowVersion,
  WorkflowStatus,
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
    private machineService: MachineService,
    private agentRepo: AgentRepository,
    private fileTransfer: FileTransfer,
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

    const approvedSkills = await this.skillRepo.findAll({ reviewStatus: 'approved' });
    const approvedSkillKeys = new Set(approvedSkills.map((s) => s.skillKey));

    return validateWorkflow(workflow.nodes, workflow.edges, approvedSkillKeys);
  }

  // --- YAML Generation ---

  async generateYaml(id: string): Promise<string> {
    const workflow = await this.getWorkflow(id);
    return generateWorkflowYaml(workflow);
  }

  // --- Deploy to Machine ---

  async deployWorkflowToMachine(
    workflowId: string,
    machineId: string,
    deployedBy: string,
    scope: 'global' | 'agent' = 'global',
    agentId?: string,
  ): Promise<Workflow> {
    const workflow = await this.getWorkflow(workflowId);

    const validation = await this.validateWorkflow(workflowId);
    if (!validation.valid) {
      throw new ValidationError('Workflow validation failed', {
        errors: validation.errors,
      });
    }

    const yamlContent = generateWorkflowYaml(workflow);
    const machine = await this.machineService.getMachine(machineId);
    const connInfo = this.machineService.toConnectionInfo(machine);

    let workflowDir: string;

    if (scope === 'agent' && agentId) {
      const agent = await this.agentRepo.findById(agentId);
      if (!agent) throw new NotFoundError('Agent', agentId);
      const workspacePath = agent.workspacePath ?? 'workspace';
      workflowDir = `${machine.openclawHome}/${workspacePath}/workflows`;
    } else {
      workflowDir = `${machine.openclawHome}/workflows`;
    }

    await this.fileTransfer.ensureDirectory(connInfo, workflowDir);
    await this.fileTransfer.uploadFile(
      connInfo,
      `${workflowDir}/${workflow.workflowKey}.lobster`,
      yamlContent,
    );

    // Create version snapshot
    const nextVersion = incrementVersion(workflow.version);
    await this.repo.createVersion({
      workflowId,
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

    const updated = await this.repo.update(workflowId, {
      status: 'active',
      version: nextVersion,
      deployedAt: new Date(),
      updatedBy: deployedBy,
    });

    log.info(
      { workflowId, version: nextVersion, machineId, scope, deployedBy },
      'Workflow deployed to machine',
    );
    return updated!;
  }

  // --- Versions ---

  async listVersions(workflowId: string): Promise<WorkflowVersion[]> {
    await this.getWorkflow(workflowId);
    return this.repo.findVersions(workflowId);
  }
}

function incrementVersion(version: string): string {
  const parts = version.split('.').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return '1.0.1';
  parts[2]++;
  return parts.join('.');
}
