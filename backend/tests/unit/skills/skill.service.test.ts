import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SkillService } from '../../../src/modules/skills/skill.service.js';
import { NotFoundError, ValidationError } from '../../../src/shared/errors.js';
import type { SkillCatalogEntry } from '../../../src/modules/skills/skill.types.js';

vi.mock('../../../src/shared/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  }),
}));

function makeSkill(overrides: Partial<SkillCatalogEntry> = {}): SkillCatalogEntry {
  return {
    id: 'skill-1',
    skillKey: 'morning-standup',
    name: 'Morning Standup',
    description: 'Runs daily standup routine',
    scope: 'agent',
    source: 'custom',
    version: '1.0.0',
    frontmatter: null,
    skillMdContent: '---\nname: Morning Standup\n---\n# Morning Standup',
    auxiliaryFiles: null,
    requiresBins: null,
    requiresEnv: null,
    tags: null,
    reviewStatus: 'pending',
    reviewedBy: null,
    reviewedAt: null,
    localPath: null,
    createdAt: new Date('2026-03-01'),
    updatedAt: new Date('2026-03-01'),
    ...overrides,
  };
}

function createMockRepo() {
  return {
    findAll: vi.fn().mockResolvedValue([]),
    findById: vi.fn().mockResolvedValue(null),
    findByKey: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue(makeSkill()),
    update: vi.fn().mockResolvedValue(makeSkill()),
    delete: vi.fn().mockResolvedValue(true),
    findAgentSkills: vi.fn().mockResolvedValue([]),
    installSkillOnAgent: vi.fn().mockResolvedValue({
      id: 'as-1',
      agentId: 'agent-1',
      skillCatalogId: 'skill-1',
      scope: 'agent',
      enabled: true,
      configOverrides: null,
      installedAt: new Date(),
    }),
    uninstallSkillFromAgent: vi.fn().mockResolvedValue(true),
  };
}

function createMockFileTransfer() {
  return {
    downloadFile: vi.fn().mockResolvedValue('---\nname: Morning Standup\n---\n# Content'),
    uploadFile: vi.fn().mockResolvedValue(undefined),
    ensureDirectory: vi.fn().mockResolvedValue(undefined),
  } as any;
}

function createMockMachineService() {
  return {
    getMachine: vi.fn().mockResolvedValue({
      id: 'machine-1',
      tailscaleHostname: 'node-1',
      sshPort: 22,
      sshUser: 'claw',
      openclawHome: '~/.openclaw',
    }),
    toConnectionInfo: vi.fn().mockReturnValue({
      machineId: 'machine-1',
      host: 'node-1',
      port: 22,
      username: 'claw',
    }),
  } as any;
}

function createMockAgentRepo() {
  return {
    findById: vi.fn().mockResolvedValue(null),
  } as any;
}

describe('SkillService', () => {
  let service: SkillService;
  let repo: ReturnType<typeof createMockRepo>;
  let fileTransfer: ReturnType<typeof createMockFileTransfer>;
  let machineService: ReturnType<typeof createMockMachineService>;
  let agentRepo: ReturnType<typeof createMockAgentRepo>;

  beforeEach(() => {
    repo = createMockRepo();
    fileTransfer = createMockFileTransfer();
    machineService = createMockMachineService();
    agentRepo = createMockAgentRepo();
    service = new SkillService(repo as any, fileTransfer, machineService, agentRepo);
  });

  describe('listSkills', () => {
    it('returns all skills from repository', async () => {
      const skills = [makeSkill(), makeSkill({ id: 'skill-2', skillKey: 'daily-report' })];
      repo.findAll.mockResolvedValue(skills);
      const result = await service.listSkills();
      expect(result).toEqual(skills);
      expect(repo.findAll).toHaveBeenCalledWith(undefined);
    });

    it('passes filters to repository', async () => {
      await service.listSkills({ source: 'custom', scope: 'agent' });
      expect(repo.findAll).toHaveBeenCalledWith({ source: 'custom', scope: 'agent' });
    });
  });

  describe('getSkill', () => {
    it('returns skill when found', async () => {
      repo.findById.mockResolvedValue(makeSkill());
      const result = await service.getSkill('skill-1');
      expect(result.id).toBe('skill-1');
    });

    it('throws NotFoundError when not found', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.getSkill('nonexistent')).rejects.toThrow(NotFoundError);
    });
  });

  describe('createSkill', () => {
    it('creates a skill with valid input', async () => {
      const result = await service.createSkill({
        skillKey: 'morning-standup',
        name: 'Morning Standup',
      });
      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({
        skillKey: 'morning-standup',
        name: 'Morning Standup',
      }));
      expect(result.id).toBe('skill-1');
    });

    it('throws ValidationError for empty skillKey', async () => {
      await expect(
        service.createSkill({ skillKey: '', name: 'Test' }),
      ).rejects.toThrow(ValidationError);
    });

    it('throws ValidationError for empty name', async () => {
      await expect(
        service.createSkill({ skillKey: 'test', name: '' }),
      ).rejects.toThrow(ValidationError);
    });

    it('throws ValidationError for duplicate skillKey', async () => {
      repo.findByKey.mockResolvedValue(makeSkill());
      await expect(
        service.createSkill({ skillKey: 'morning-standup', name: 'Duplicate' }),
      ).rejects.toThrow(ValidationError);
    });
  });

  describe('updateSkill', () => {
    it('updates skill fields', async () => {
      repo.findById.mockResolvedValue(makeSkill());
      repo.update.mockResolvedValue(makeSkill({ name: 'Updated Name' }));

      const result = await service.updateSkill('skill-1', { name: 'Updated Name' });
      expect(repo.update).toHaveBeenCalledWith('skill-1', { name: 'Updated Name' });
      expect(result.name).toBe('Updated Name');
    });

    it('throws NotFoundError for non-existent skill', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(
        service.updateSkill('nonexistent', { name: 'Nope' }),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('deleteSkill', () => {
    it('deletes existing skill', async () => {
      repo.delete.mockResolvedValue(true);
      await expect(service.deleteSkill('skill-1')).resolves.toBeUndefined();
    });

    it('throws NotFoundError for non-existent skill', async () => {
      repo.delete.mockResolvedValue(false);
      await expect(service.deleteSkill('nonexistent')).rejects.toThrow(NotFoundError);
    });
  });

  describe('approveSkill', () => {
    it('sets review status to approved', async () => {
      repo.findById.mockResolvedValue(makeSkill());
      repo.update.mockResolvedValue(makeSkill({ reviewStatus: 'approved' }));

      const result = await service.approveSkill('skill-1', 'admin');
      expect(repo.update).toHaveBeenCalledWith('skill-1', {
        reviewStatus: 'approved',
        reviewedBy: 'admin',
      });
      expect(result.reviewStatus).toBe('approved');
    });
  });

  describe('rejectSkill', () => {
    it('sets review status to rejected', async () => {
      repo.findById.mockResolvedValue(makeSkill());
      repo.update.mockResolvedValue(makeSkill({ reviewStatus: 'rejected' }));

      const result = await service.rejectSkill('skill-1', 'admin');
      expect(repo.update).toHaveBeenCalledWith('skill-1', {
        reviewStatus: 'rejected',
        reviewedBy: 'admin',
      });
      expect(result.reviewStatus).toBe('rejected');
    });
  });

  describe('installSkillOnAgent', () => {
    it('installs an approved skill on an agent', async () => {
      repo.findById.mockResolvedValue(makeSkill({ reviewStatus: 'approved' }));

      const result = await service.installSkillOnAgent('agent-1', {
        skillCatalogId: 'skill-1',
        scope: 'agent',
      });

      expect(repo.installSkillOnAgent).toHaveBeenCalledWith('agent-1', 'skill-1', 'agent', undefined);
      expect(result.agentId).toBe('agent-1');
    });

    it('throws ValidationError when skill is not approved', async () => {
      repo.findById.mockResolvedValue(makeSkill({ reviewStatus: 'pending' }));

      await expect(
        service.installSkillOnAgent('agent-1', { skillCatalogId: 'skill-1' }),
      ).rejects.toThrow(ValidationError);
    });
  });

  describe('uninstallSkillFromAgent', () => {
    it('uninstalls skill from agent', async () => {
      repo.uninstallSkillFromAgent.mockResolvedValue(true);
      await expect(
        service.uninstallSkillFromAgent('agent-1', 'skill-1'),
      ).resolves.toBeUndefined();
    });

    it('throws NotFoundError when skill not installed', async () => {
      repo.uninstallSkillFromAgent.mockResolvedValue(false);
      await expect(
        service.uninstallSkillFromAgent('agent-1', 'skill-1'),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('importSkillFromRemote', () => {
    it('imports SKILL.md from remote machine and creates catalog entry', async () => {
      repo.findByKey.mockResolvedValue(null);
      fileTransfer.downloadFile.mockResolvedValue(
        '---\nname: Morning Standup\ndescription: Runs daily standup\n---\n# Standup Instructions',
      );

      const result = await service.importSkillFromRemote('machine-1', 'morning-standup', 'global');

      expect(fileTransfer.downloadFile).toHaveBeenCalledWith(
        expect.objectContaining({ machineId: 'machine-1' }),
        '~/.openclaw/skills/morning-standup/SKILL.md',
      );
      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({
        skillKey: 'morning-standup',
      }));
      expect(result.id).toBe('skill-1');
    });

    it('updates existing skill on reimport', async () => {
      repo.findByKey.mockResolvedValue(makeSkill());
      repo.update.mockResolvedValue(makeSkill());
      fileTransfer.downloadFile.mockResolvedValue('---\nname: Updated\n---\n# Body');

      const result = await service.importSkillFromRemote('machine-1', 'morning-standup', 'global');

      expect(repo.update).toHaveBeenCalledWith('skill-1', expect.objectContaining({
        skillMdContent: '---\nname: Updated\n---\n# Body',
      }));
      expect(result.id).toBe('skill-1');
    });
  });

  describe('deploySkillToMachine', () => {
    it('uploads SKILL.md to global skills dir when scope is global', async () => {
      repo.findById.mockResolvedValue(
        makeSkill({
          skillMdContent: '---\nname: Morning Standup\n---\n# Content',
        }),
      );

      await service.deploySkillToMachine('skill-1', 'machine-1', 'global');

      expect(fileTransfer.ensureDirectory).toHaveBeenCalledWith(
        expect.objectContaining({ machineId: 'machine-1' }),
        '~/.openclaw/skills/morning-standup',
      );
      expect(fileTransfer.uploadFile).toHaveBeenCalledWith(
        expect.objectContaining({ machineId: 'machine-1' }),
        '~/.openclaw/skills/morning-standup/SKILL.md',
        '---\nname: Morning Standup\n---\n# Content',
      );
    });

    it('uploads SKILL.md to agent workspace skills dir when agentId is provided', async () => {
      repo.findById.mockResolvedValue(
        makeSkill({
          skillMdContent: '---\nname: Morning Standup\n---\n# Content',
        }),
      );
      agentRepo.findById.mockResolvedValue({
        id: 'agent-1',
        machineId: 'machine-1',
        agentId: 'pm',
        workspacePath: 'workspace-pm',
        isDefault: false,
      });

      await service.deploySkillToMachine('skill-1', 'machine-1', 'agent', 'agent-1');

      expect(agentRepo.findById).toHaveBeenCalledWith('agent-1');
      expect(fileTransfer.ensureDirectory).toHaveBeenCalledWith(
        expect.objectContaining({ machineId: 'machine-1' }),
        '~/.openclaw/workspace-pm/skills/morning-standup',
      );
      expect(fileTransfer.uploadFile).toHaveBeenCalledWith(
        expect.objectContaining({ machineId: 'machine-1' }),
        '~/.openclaw/workspace-pm/skills/morning-standup/SKILL.md',
        '---\nname: Morning Standup\n---\n# Content',
      );
    });

    it('uses default workspace path for default agent', async () => {
      repo.findById.mockResolvedValue(
        makeSkill({
          skillMdContent: '---\nname: Test\n---\n# Body',
        }),
      );
      agentRepo.findById.mockResolvedValue({
        id: 'agent-2',
        machineId: 'machine-1',
        agentId: 'main',
        workspacePath: 'workspace',
        isDefault: true,
      });

      await service.deploySkillToMachine('skill-1', 'machine-1', 'agent', 'agent-2');

      expect(fileTransfer.ensureDirectory).toHaveBeenCalledWith(
        expect.objectContaining({ machineId: 'machine-1' }),
        '~/.openclaw/workspace/skills/morning-standup',
      );
    });

    it('throws NotFoundError when agentId is provided but agent not found', async () => {
      repo.findById.mockResolvedValue(
        makeSkill({ skillMdContent: '---\nname: Test\n---\n# Body' }),
      );
      agentRepo.findById.mockResolvedValue(null);

      await expect(
        service.deploySkillToMachine('skill-1', 'machine-1', 'agent', 'nonexistent'),
      ).rejects.toThrow(NotFoundError);
    });

    it('throws ValidationError when skill has no content', async () => {
      repo.findById.mockResolvedValue(makeSkill({ skillMdContent: null }));

      await expect(
        service.deploySkillToMachine('skill-1', 'machine-1', 'global'),
      ).rejects.toThrow(ValidationError);
    });
  });

  describe('tags', () => {
    it('creates a skill with tags', async () => {
      const skillWithTags = makeSkill({ tags: ['automation', 'daily'] });
      repo.create.mockResolvedValue(skillWithTags);

      const result = await service.createSkill({
        skillKey: 'morning-standup',
        name: 'Morning Standup',
        tags: ['automation', 'daily'],
      });

      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({
        tags: ['automation', 'daily'],
      }));
      expect(result.tags).toEqual(['automation', 'daily']);
    });

    it('updates skill tags', async () => {
      repo.findById.mockResolvedValue(makeSkill());
      repo.update.mockResolvedValue(makeSkill({ tags: ['updated-tag'] }));

      const result = await service.updateSkill('skill-1', {
        tags: ['updated-tag'],
      });

      expect(repo.update).toHaveBeenCalledWith('skill-1', { tags: ['updated-tag'] });
      expect(result.tags).toEqual(['updated-tag']);
    });

    it('clears tags by setting empty array', async () => {
      repo.findById.mockResolvedValue(makeSkill({ tags: ['old-tag'] }));
      repo.update.mockResolvedValue(makeSkill({ tags: [] }));

      const result = await service.updateSkill('skill-1', { tags: [] });

      expect(repo.update).toHaveBeenCalledWith('skill-1', { tags: [] });
      expect(result.tags).toEqual([]);
    });

    it('passes tag filter to repository', async () => {
      await service.listSkills({ tag: 'automation' });
      expect(repo.findAll).toHaveBeenCalledWith({ tag: 'automation' });
    });
  });
});
