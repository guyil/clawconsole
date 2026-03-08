import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorkflowService } from '../../../src/modules/workflows/workflow.service.js';
import { NotFoundError, ValidationError } from '../../../src/shared/errors.js';
import type { Workflow } from '../../../src/modules/workflows/workflow.types.js';

vi.mock('../../../src/shared/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  }),
}));

function makeWorkflow(overrides: Partial<Workflow> = {}): Workflow {
  return {
    id: 'wf-1',
    name: 'content-pipeline',
    description: 'Test workflow',
    workflowKey: 'content-pipeline',
    machineId: 'machine-1',
    agentId: null,
    status: 'draft',
    version: '1.0.0',
    triggerConfig: { type: 'manual' },
    nodes: [
      {
        id: 'draft',
        type: 'skill',
        name: 'Generate Draft',
        command: 'exec --json --shell "python draft.py"',
      },
      {
        id: 'review',
        type: 'review',
        name: 'Manager Approval',
        prompt: 'Please review the draft',
      },
    ],
    edges: [{ source: 'draft', target: 'review' }],
    variables: null,
    canvasState: null,
    createdBy: 'admin',
    updatedBy: null,
    deployedAt: null,
    createdAt: new Date('2026-03-01'),
    updatedAt: new Date('2026-03-01'),
    ...overrides,
  };
}

function createMockRepo() {
  return {
    findAll: vi.fn().mockResolvedValue([]),
    findById: vi.fn().mockResolvedValue(null),
    findByName: vi.fn().mockResolvedValue(null),
    findByKey: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue(makeWorkflow()),
    update: vi.fn().mockResolvedValue(makeWorkflow()),
    delete: vi.fn().mockResolvedValue(true),
    findVersions: vi.fn().mockResolvedValue([]),
    findVersionById: vi.fn().mockResolvedValue(null),
    createVersion: vi.fn().mockResolvedValue({
      id: 'ver-1',
      workflowId: 'wf-1',
      version: '1.0.1',
      snapshotJson: {},
      changeLog: null,
      createdBy: 'admin',
      createdAt: new Date(),
    }),
  };
}

function createMockSkillRepo() {
  return {
    findAll: vi.fn().mockResolvedValue([
      {
        id: 's-1',
        skillKey: 'content-writer',
        name: 'Content Writer',
        reviewStatus: 'approved',
      },
    ]),
    findById: vi.fn().mockResolvedValue(null),
    findByKey: vi.fn().mockResolvedValue(null),
  } as ReturnType<typeof createMockSkillRepo>;
}

function createMockMachineService() {
  return {
    getMachine: vi.fn().mockResolvedValue({
      id: 'machine-1',
      name: 'Test Machine',
      openclawHome: '/home/user/.openclaw',
    }),
    toConnectionInfo: vi.fn().mockReturnValue({
      host: 'test-host',
      port: 22,
      username: 'user',
    }),
  } as ReturnType<typeof createMockMachineService>;
}

function createMockAgentRepo() {
  return {
    findById: vi.fn().mockResolvedValue({
      id: 'agent-1',
      workspacePath: 'workspace',
    }),
  } as ReturnType<typeof createMockAgentRepo>;
}

function createMockFileTransfer() {
  return {
    ensureDirectory: vi.fn().mockResolvedValue(undefined),
    uploadFile: vi.fn().mockResolvedValue(undefined),
  } as ReturnType<typeof createMockFileTransfer>;
}

describe('WorkflowService', () => {
  let service: WorkflowService;
  let repo: ReturnType<typeof createMockRepo>;
  let skillRepo: ReturnType<typeof createMockSkillRepo>;
  let machineService: ReturnType<typeof createMockMachineService>;
  let agentRepo: ReturnType<typeof createMockAgentRepo>;
  let fileTransfer: ReturnType<typeof createMockFileTransfer>;

  beforeEach(() => {
    repo = createMockRepo();
    skillRepo = createMockSkillRepo();
    machineService = createMockMachineService();
    agentRepo = createMockAgentRepo();
    fileTransfer = createMockFileTransfer();
    service = new WorkflowService(
      repo as any,
      skillRepo as any,
      machineService as any,
      agentRepo as any,
      fileTransfer as any,
    );
  });

  // --- Workflow CRUD ---

  describe('listWorkflows', () => {
    it('returns all workflows', async () => {
      const workflows = [makeWorkflow()];
      repo.findAll.mockResolvedValue(workflows);
      const result = await service.listWorkflows();
      expect(result).toEqual(workflows);
    });

    it('passes filters', async () => {
      await service.listWorkflows({ machineId: 'machine-1', status: 'active' });
      expect(repo.findAll).toHaveBeenCalledWith({ machineId: 'machine-1', status: 'active' });
    });
  });

  describe('getWorkflow', () => {
    it('returns workflow when found', async () => {
      repo.findById.mockResolvedValue(makeWorkflow());
      const result = await service.getWorkflow('wf-1');
      expect(result.id).toBe('wf-1');
    });

    it('throws NotFoundError when not found', async () => {
      await expect(service.getWorkflow('nonexistent')).rejects.toThrow(NotFoundError);
    });
  });

  describe('createWorkflow', () => {
    it('creates a workflow with valid input', async () => {
      const result = await service.createWorkflow({
        name: 'content-pipeline',
        machineId: 'machine-1',
        triggerConfig: { type: 'manual' },
        nodes: [{
          id: 'draft',
          type: 'skill',
          name: 'Draft',
          command: 'exec draft',
        }],
        edges: [],
        createdBy: 'admin',
      });
      expect(repo.create).toHaveBeenCalled();
      expect(result.id).toBe('wf-1');
    });

    it('throws ValidationError for empty name', async () => {
      await expect(
        service.createWorkflow({
          name: '',
          machineId: 'machine-1',
          triggerConfig: { type: 'manual' },
          nodes: [{ id: 'a', type: 'skill', name: 'A', command: 'test' }],
          edges: [],
          createdBy: 'admin',
        }),
      ).rejects.toThrow(ValidationError);
    });

    it('throws ValidationError for empty machineId', async () => {
      await expect(
        service.createWorkflow({
          name: 'test',
          machineId: '',
          triggerConfig: { type: 'manual' },
          nodes: [{ id: 'a', type: 'skill', name: 'A', command: 'test' }],
          edges: [],
          createdBy: 'admin',
        }),
      ).rejects.toThrow(ValidationError);
    });

    it('throws ValidationError for duplicate name on same machine', async () => {
      repo.findByName.mockResolvedValue(makeWorkflow());
      await expect(
        service.createWorkflow({
          name: 'content-pipeline',
          machineId: 'machine-1',
          triggerConfig: { type: 'manual' },
          nodes: [{ id: 'a', type: 'skill', name: 'A', command: 'test' }],
          edges: [],
          createdBy: 'admin',
        }),
      ).rejects.toThrow(ValidationError);
    });
  });

  describe('updateWorkflow', () => {
    it('updates workflow fields', async () => {
      repo.findById.mockResolvedValue(makeWorkflow());
      repo.update.mockResolvedValue(makeWorkflow({ name: 'Updated' }));

      const result = await service.updateWorkflow('wf-1', { name: 'Updated' });
      expect(repo.update).toHaveBeenCalledWith('wf-1', { name: 'Updated' });
      expect(result.name).toBe('Updated');
    });

    it('throws NotFoundError for non-existent workflow', async () => {
      await expect(
        service.updateWorkflow('nonexistent', { name: 'Nope' }),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('deleteWorkflow', () => {
    it('deletes a draft workflow', async () => {
      repo.findById.mockResolvedValue(makeWorkflow({ status: 'draft' }));
      await expect(service.deleteWorkflow('wf-1')).resolves.toBeUndefined();
    });

    it('throws ValidationError for active workflow', async () => {
      repo.findById.mockResolvedValue(makeWorkflow({ status: 'active' }));
      await expect(service.deleteWorkflow('wf-1')).rejects.toThrow(ValidationError);
    });

    it('throws NotFoundError when delete returns false', async () => {
      repo.findById.mockResolvedValue(makeWorkflow({ status: 'draft' }));
      repo.delete.mockResolvedValue(false);
      await expect(service.deleteWorkflow('wf-1')).rejects.toThrow(NotFoundError);
    });
  });

  // --- Validation ---

  describe('validateWorkflow', () => {
    it('returns valid result for valid workflow', async () => {
      repo.findById.mockResolvedValue(makeWorkflow());
      const result = await service.validateWorkflow('wf-1');
      expect(result.valid).toBe(true);
    });

    it('returns errors for invalid workflow', async () => {
      repo.findById.mockResolvedValue(makeWorkflow({
        nodes: [
          {
            id: 'broken',
            type: 'skill',
            name: 'Broken',
            command: '',
          },
        ],
        edges: [],
      }));

      const result = await service.validateWorkflow('wf-1');
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  // --- Deploy to Machine ---

  describe('deployWorkflowToMachine', () => {
    it('deploys workflow to machine and creates version', async () => {
      repo.findById.mockResolvedValue(makeWorkflow());
      repo.update.mockResolvedValue(makeWorkflow({ status: 'active', version: '1.0.1' }));

      const result = await service.deployWorkflowToMachine('wf-1', 'machine-1', 'admin');

      expect(fileTransfer.ensureDirectory).toHaveBeenCalledWith(
        expect.anything(),
        '/home/user/.openclaw/workflows',
      );
      expect(fileTransfer.uploadFile).toHaveBeenCalledWith(
        expect.anything(),
        '/home/user/.openclaw/workflows/content-pipeline.lobster',
        expect.stringContaining('name: content-pipeline'),
      );
      expect(repo.createVersion).toHaveBeenCalledWith(
        expect.objectContaining({
          workflowId: 'wf-1',
          version: '1.0.1',
          createdBy: 'admin',
        }),
      );
      expect(result.status).toBe('active');
    });

    it('deploys to agent workspace when scope is agent', async () => {
      repo.findById.mockResolvedValue(makeWorkflow());
      repo.update.mockResolvedValue(makeWorkflow({ status: 'active' }));

      await service.deployWorkflowToMachine('wf-1', 'machine-1', 'admin', 'agent', 'agent-1');

      expect(fileTransfer.ensureDirectory).toHaveBeenCalledWith(
        expect.anything(),
        '/home/user/.openclaw/workspace/workflows',
      );
    });

    it('throws ValidationError for invalid workflow', async () => {
      repo.findById.mockResolvedValue(makeWorkflow({
        nodes: [{ id: 'a', type: 'skill', name: 'A', command: '' }],
        edges: [],
      }));

      await expect(
        service.deployWorkflowToMachine('wf-1', 'machine-1', 'admin'),
      ).rejects.toThrow(ValidationError);
    });
  });
});
