import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CredentialService } from '../../../src/modules/credentials/credential.service.js';
import { NotFoundError, ValidationError } from '../../../src/shared/errors.js';
import type { Credential } from '../../../src/modules/credentials/credential.types.js';

vi.mock('../../../src/shared/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  }),
}));

function makeCred(overrides: Partial<Credential> = {}): Credential {
  return {
    id: 'cred-1',
    machineId: 'machine-1',
    name: 'Anthropic API Key',
    credentialType: 'api_key',
    provider: 'anthropic',
    targetFilePath: 'credentials/anthropic.json',
    description: 'Main API key',
    createdAt: new Date('2026-03-01'),
    updatedAt: new Date('2026-03-01'),
    ...overrides,
  };
}

function createMockRepo() {
  return {
    findAll: vi.fn().mockResolvedValue([]),
    findById: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue(makeCred()),
    updateValue: vi.fn().mockResolvedValue(undefined),
    updateMeta: vi.fn().mockResolvedValue(undefined),
    getDecryptedValue: vi.fn().mockResolvedValue('sk-secret-key'),
    findByMachineAndPath: vi.fn().mockResolvedValue(null),
    delete: vi.fn().mockResolvedValue(true),
  };
}

function createMockFileTransfer() {
  return {
    ensureDirectory: vi.fn().mockResolvedValue(undefined),
    uploadCredential: vi.fn().mockResolvedValue(undefined),
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

describe('CredentialService', () => {
  let service: CredentialService;
  let repo: ReturnType<typeof createMockRepo>;
  let fileTransfer: ReturnType<typeof createMockFileTransfer>;
  let machineService: ReturnType<typeof createMockMachineService>;

  beforeEach(() => {
    repo = createMockRepo();
    fileTransfer = createMockFileTransfer();
    machineService = createMockMachineService();
    service = new CredentialService(repo as any, fileTransfer, machineService);
  });

  describe('createCredential', () => {
    it('creates a credential with valid input', async () => {
      const result = await service.createCredential({
        name: 'Anthropic API Key',
        credentialType: 'api_key',
        value: 'sk-secret-key',
        provider: 'anthropic',
      });

      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({
        name: 'Anthropic API Key',
        credentialType: 'api_key',
        value: 'sk-secret-key',
      }));
      expect(result.id).toBe('cred-1');
    });

    it('throws ValidationError for empty value', async () => {
      await expect(
        service.createCredential({
          name: 'Test',
          credentialType: 'api_key',
          value: '',
        }),
      ).rejects.toThrow(ValidationError);
    });

    it('throws ValidationError for whitespace-only value', async () => {
      await expect(
        service.createCredential({
          name: 'Test',
          credentialType: 'api_key',
          value: '   ',
        }),
      ).rejects.toThrow(ValidationError);
    });
  });

  describe('getCredential', () => {
    it('returns credential when found', async () => {
      repo.findById.mockResolvedValue(makeCred());
      const result = await service.getCredential('cred-1');
      expect(result.id).toBe('cred-1');
    });

    it('throws NotFoundError when not found', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.getCredential('nonexistent')).rejects.toThrow(NotFoundError);
    });
  });

  describe('updateCredential', () => {
    it('updates value and metadata', async () => {
      repo.findById.mockResolvedValue(makeCred());

      await service.updateCredential('cred-1', {
        name: 'Updated Name',
        value: 'new-secret',
      });

      expect(repo.updateValue).toHaveBeenCalledWith('cred-1', 'new-secret');
      expect(repo.updateMeta).toHaveBeenCalledWith('cred-1', { name: 'Updated Name' });
    });

    it('updates only metadata when no value provided', async () => {
      repo.findById.mockResolvedValue(makeCred());

      await service.updateCredential('cred-1', { description: 'Updated desc' });

      expect(repo.updateValue).not.toHaveBeenCalled();
      expect(repo.updateMeta).toHaveBeenCalledWith('cred-1', { description: 'Updated desc' });
    });
  });

  describe('deleteCredential', () => {
    it('deletes existing credential', async () => {
      repo.delete.mockResolvedValue(true);
      await expect(service.deleteCredential('cred-1')).resolves.toBeUndefined();
    });

    it('throws NotFoundError for non-existent credential', async () => {
      repo.delete.mockResolvedValue(false);
      await expect(service.deleteCredential('nonexistent')).rejects.toThrow(NotFoundError);
    });
  });

  describe('syncCredentialToMachine', () => {
    it('uploads decrypted value to remote path', async () => {
      repo.findById.mockResolvedValue(makeCred());
      repo.getDecryptedValue.mockResolvedValue('sk-secret-key');

      await service.syncCredentialToMachine('cred-1', 'machine-1');

      expect(fileTransfer.ensureDirectory).toHaveBeenCalledWith(
        expect.objectContaining({ machineId: 'machine-1' }),
        '~/.openclaw/credentials',
      );
      expect(fileTransfer.uploadCredential).toHaveBeenCalledWith(
        expect.objectContaining({ machineId: 'machine-1' }),
        '~/.openclaw/credentials/anthropic.json',
        'sk-secret-key',
      );
    });

    it('throws ValidationError when no target file path', async () => {
      repo.findById.mockResolvedValue(makeCred({ targetFilePath: null }));

      await expect(
        service.syncCredentialToMachine('cred-1', 'machine-1'),
      ).rejects.toThrow(ValidationError);
    });
  });

  describe('syncAllCredentialsToMachine', () => {
    it('syncs all credentials with target paths', async () => {
      repo.findAll.mockResolvedValue([
        makeCred({ id: 'c1', targetFilePath: 'credentials/a.json' }),
        makeCred({ id: 'c2', targetFilePath: 'credentials/b.json' }),
        makeCred({ id: 'c3', targetFilePath: null }),
      ]);
      repo.findById.mockImplementation(async (id: string) => {
        if (id === 'c1') return makeCred({ id: 'c1', targetFilePath: 'credentials/a.json' });
        if (id === 'c2') return makeCred({ id: 'c2', targetFilePath: 'credentials/b.json' });
        return null;
      });
      repo.getDecryptedValue.mockResolvedValue('secret');

      const result = await service.syncAllCredentialsToMachine('machine-1');

      expect(result.synced).toBe(2);
      expect(result.failed).toBe(0);
    });

    it('counts failures and continues syncing', async () => {
      repo.findAll.mockResolvedValue([
        makeCred({ id: 'c1', targetFilePath: 'credentials/a.json' }),
        makeCred({ id: 'c2', targetFilePath: 'credentials/b.json' }),
      ]);
      repo.findById.mockImplementation(async (id: string) => {
        if (id === 'c1') return makeCred({ id: 'c1', targetFilePath: 'credentials/a.json' });
        if (id === 'c2') return makeCred({ id: 'c2', targetFilePath: 'credentials/b.json' });
        return null;
      });
      repo.getDecryptedValue.mockResolvedValueOnce('secret').mockResolvedValueOnce('secret');
      fileTransfer.uploadCredential
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('SSH failed'));

      const result = await service.syncAllCredentialsToMachine('machine-1');

      expect(result.synced).toBe(1);
      expect(result.failed).toBe(1);
    });
  });
});
