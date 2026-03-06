import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorkflowService } from '../../../src/modules/workflows/workflow.service.js';
import { NotFoundError, ValidationError } from '../../../src/shared/errors.js';
import type {
  Workflow,
  WorkflowRun,
  WorkflowReview,
  WorkflowRunNode,
} from '../../../src/modules/workflows/workflow.types.js';

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
        skillRef: 'content-writer',
        output: 'draft_result',
      },
      {
        id: 'review',
        type: 'review',
        name: 'Manager Review',
        reviewers: [{ role: 'manager' }],
        policy: 'any',
        timeout: '2h',
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

function makeRun(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id: 'run-1',
    workflowId: 'wf-1',
    runId: 'lobster-run-abc',
    machineId: 'machine-1',
    status: 'running',
    triggerInfo: null,
    currentNodes: ['draft'],
    variables: null,
    startedAt: new Date('2026-03-01T10:00:00Z'),
    completedAt: null,
    errorMessage: null,
    syncedAt: new Date('2026-03-01T10:01:00Z'),
    ...overrides,
  };
}

function makeReview(overrides: Partial<WorkflowReview> = {}): WorkflowReview {
  return {
    id: 'rev-1',
    runId: 'run-1',
    nodeId: 'review',
    status: 'pending',
    reviewers: [{ role: 'manager' }],
    policy: 'any',
    payload: { title: 'Review this content' },
    timeoutAt: new Date('2026-03-01T12:00:00Z'),
    decision: null,
    decidedBy: null,
    comments: null,
    decidedAt: null,
    createdAt: new Date('2026-03-01T10:00:00Z'),
    ...overrides,
  };
}

function createMockRepo() {
  return {
    findAll: vi.fn().mockResolvedValue([]),
    findById: vi.fn().mockResolvedValue(null),
    findByName: vi.fn().mockResolvedValue(null),
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
    findRuns: vi.fn().mockResolvedValue([]),
    findRunById: vi.fn().mockResolvedValue(null),
    findRunByRunId: vi.fn().mockResolvedValue(null),
    upsertRun: vi.fn().mockResolvedValue(makeRun()),
    updateRunStatus: vi.fn().mockResolvedValue(makeRun({ status: 'aborted' })),
    findRunNodes: vi.fn().mockResolvedValue([]),
    upsertRunNode: vi.fn().mockResolvedValue(null),
    findPendingReviews: vi.fn().mockResolvedValue([]),
    findReviewByRunAndNode: vi.fn().mockResolvedValue(null),
    findReviewById: vi.fn().mockResolvedValue(null),
    createReview: vi.fn().mockResolvedValue(makeReview()),
    updateReviewDecision: vi.fn().mockResolvedValue(makeReview({ status: 'approved', decision: 'approved' })),
    updateReviewStatus: vi.fn().mockResolvedValue(makeReview({ status: 'expired' })),
    findExpiredReviews: vi.fn().mockResolvedValue([]),
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
  } as any;
}

describe('WorkflowService', () => {
  let service: WorkflowService;
  let repo: ReturnType<typeof createMockRepo>;
  let skillRepo: ReturnType<typeof createMockSkillRepo>;

  beforeEach(() => {
    repo = createMockRepo();
    skillRepo = createMockSkillRepo();
    service = new WorkflowService(repo as any, skillRepo);
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
          skillRef: 'content-writer',
          output: 'draft_result',
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
          nodes: [{ id: 'a', type: 'skill', name: 'A', skillRef: 'x', output: 'r' }],
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
          nodes: [{ id: 'a', type: 'skill', name: 'A', skillRef: 'x', output: 'r' }],
          edges: [],
          createdBy: 'admin',
        }),
      ).rejects.toThrow(ValidationError);
    });

    it('throws ValidationError for empty nodes', async () => {
      await expect(
        service.createWorkflow({
          name: 'test',
          machineId: 'machine-1',
          triggerConfig: { type: 'manual' },
          nodes: [],
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
          nodes: [{ id: 'a', type: 'skill', name: 'A', skillRef: 'x', output: 'r' }],
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
            skillRef: '',
            output: '',
          },
        ],
        edges: [],
      }));

      const result = await service.validateWorkflow('wf-1');
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  // --- Deploy ---

  describe('deployWorkflow', () => {
    it('deploys a valid workflow and creates a version snapshot', async () => {
      repo.findById.mockResolvedValue(makeWorkflow());
      repo.update.mockResolvedValue(makeWorkflow({ status: 'active', version: '1.0.1' }));

      const result = await service.deployWorkflow('wf-1', 'admin');

      expect(repo.createVersion).toHaveBeenCalledWith(
        expect.objectContaining({
          workflowId: 'wf-1',
          version: '1.0.1',
          createdBy: 'admin',
        }),
      );
      expect(repo.update).toHaveBeenCalledWith('wf-1', expect.objectContaining({
        status: 'active',
        version: '1.0.1',
      }));
      expect(result.status).toBe('active');
    });

    it('throws ValidationError for invalid workflow', async () => {
      repo.findById.mockResolvedValue(makeWorkflow({
        nodes: [{ id: 'a', type: 'skill', name: 'A', skillRef: '', output: '' }],
        edges: [],
      }));

      await expect(service.deployWorkflow('wf-1', 'admin')).rejects.toThrow(ValidationError);
    });
  });

  // --- Workflow Runs ---

  describe('getRun', () => {
    it('returns run when found', async () => {
      repo.findRunById.mockResolvedValue(makeRun());
      const result = await service.getRun('run-1');
      expect(result.id).toBe('run-1');
    });

    it('throws NotFoundError when not found', async () => {
      await expect(service.getRun('nonexistent')).rejects.toThrow(NotFoundError);
    });
  });

  describe('abortRun', () => {
    it('aborts a running workflow', async () => {
      repo.findRunById.mockResolvedValue(makeRun({ status: 'running' }));
      const result = await service.abortRun('run-1');
      expect(repo.updateRunStatus).toHaveBeenCalledWith('run-1', 'aborted');
      expect(result.status).toBe('aborted');
    });

    it('throws ValidationError for already completed run', async () => {
      repo.findRunById.mockResolvedValue(makeRun({ status: 'completed' }));
      await expect(service.abortRun('run-1')).rejects.toThrow(ValidationError);
    });

    it('throws ValidationError for already aborted run', async () => {
      repo.findRunById.mockResolvedValue(makeRun({ status: 'aborted' }));
      await expect(service.abortRun('run-1')).rejects.toThrow(ValidationError);
    });
  });

  // --- Reviews ---

  describe('getReview', () => {
    it('returns review when found', async () => {
      repo.findReviewByRunAndNode.mockResolvedValue(makeReview());
      const result = await service.getReview('run-1', 'review');
      expect(result.id).toBe('rev-1');
    });

    it('throws NotFoundError when not found', async () => {
      await expect(service.getReview('run-1', 'nonexistent')).rejects.toThrow(NotFoundError);
    });
  });

  describe('submitReviewDecision', () => {
    it('approves a pending review', async () => {
      repo.findReviewByRunAndNode.mockResolvedValue(makeReview());
      const result = await service.submitReviewDecision(
        'run-1', 'review', 'approved', 'user-1', 'Looks good',
      );
      expect(repo.updateReviewDecision).toHaveBeenCalledWith(
        'rev-1', 'approved', 'user-1', 'Looks good',
      );
      expect(result.status).toBe('approved');
    });

    it('rejects a pending review', async () => {
      repo.findReviewByRunAndNode.mockResolvedValue(makeReview());
      repo.updateReviewDecision.mockResolvedValue(makeReview({ status: 'rejected', decision: 'rejected' }));
      const result = await service.submitReviewDecision(
        'run-1', 'review', 'rejected', 'user-1', 'Needs changes',
      );
      expect(result.status).toBe('rejected');
    });

    it('throws ValidationError for already decided review', async () => {
      repo.findReviewByRunAndNode.mockResolvedValue(makeReview({ status: 'approved' }));
      await expect(
        service.submitReviewDecision('run-1', 'review', 'approved', 'user-1'),
      ).rejects.toThrow(ValidationError);
    });
  });

  describe('checkExpiredReviews', () => {
    it('marks expired reviews', async () => {
      repo.findExpiredReviews.mockResolvedValue([makeReview()]);
      const results = await service.checkExpiredReviews();
      expect(repo.updateReviewStatus).toHaveBeenCalledWith('rev-1', 'expired');
      expect(results).toHaveLength(1);
    });

    it('returns empty array when no expired reviews', async () => {
      const results = await service.checkExpiredReviews();
      expect(results).toHaveLength(0);
    });
  });
});
