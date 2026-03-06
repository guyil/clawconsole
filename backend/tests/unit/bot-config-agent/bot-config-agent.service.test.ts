import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BotConfigAgentService } from '../../../src/modules/bot-config-agent/bot-config-agent.service.js';
import type { BotConfigAgentDeps } from '../../../src/modules/bot-config-agent/bot-config-agent.service.js';

function createMockDeps(): BotConfigAgentDeps {
  return {
    agentRepo: {
      findById: vi.fn().mockResolvedValue({
        id: 'agent-1',
        machineId: 'machine-1',
        agentId: 'main',
        name: 'TestBot',
        workspacePath: 'workspace',
        status: 'online',
      }),
    } as any,
    fileRepo: {
      findByPath: vi.fn().mockResolvedValue(null),
      upsertFile: vi.fn().mockResolvedValue('file-id-1'),
    } as any,
    machineService: {
      getMachine: vi.fn().mockResolvedValue({
        id: 'machine-1',
        tailscaleHostname: 'test-host',
        sshPort: 22,
        sshUser: 'user',
        openclawHome: '~/.openclaw',
      }),
      toConnectionInfo: vi.fn().mockReturnValue({
        machineId: 'machine-1',
        host: 'test-host',
        port: 22,
        username: 'user',
      }),
    } as any,
    syncEngine: {
      executePush: vi.fn().mockResolvedValue({
        status: 'completed',
        syncedFiles: 1,
        failedFiles: 0,
        errors: [],
      }),
    } as any,
    sshPool: {
      executeCommand: vi.fn().mockResolvedValue({
        stdout: '/home/user/.openclaw/workspace\nSOUL.md\nIDENTITY.md\n',
      }),
    } as any,
    fileTransfer: {
      downloadFile: vi.fn().mockImplementation((_conn: unknown, path: string) => {
        if (path.endsWith('SOUL.md')) return Promise.resolve('# Soul\nBe helpful.');
        if (path.endsWith('IDENTITY.md')) return Promise.resolve('# Identity\nName: Bot');
        return Promise.resolve('');
      }),
    } as any,
  };
}

describe('BotConfigAgentService', () => {
  let service: BotConfigAgentService;
  let deps: BotConfigAgentDeps;

  beforeEach(() => {
    deps = createMockDeps();
    service = new BotConfigAgentService(deps);
  });

  describe('getOrCreateSession', () => {
    it('creates a session with files loaded from remote', async () => {
      const session = await service.getOrCreateSession('agent-1');

      expect(session.agentId).toBe('agent-1');
      expect(session.machineId).toBe('machine-1');
      expect(session.status).toBe('active');
      expect(session.files.size).toBe(2);
      expect(session.files.get('SOUL.md')?.currentContent).toBe('# Soul\nBe helpful.');
      expect(session.files.get('IDENTITY.md')?.currentContent).toBe('# Identity\nName: Bot');
    });

    it('reuses existing session for same agent', async () => {
      const session1 = await service.getOrCreateSession('agent-1');
      const session2 = await service.getOrCreateSession('agent-1');

      expect(session1.id).toBe(session2.id);
    });

    it('throws when agent not found', async () => {
      (deps.agentRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      await expect(service.getOrCreateSession('nonexistent')).rejects.toThrow();
    });

    it('throws when SSH connection fails', async () => {
      (deps.sshPool.executeCommand as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('SSH timeout'));
      await expect(service.getOrCreateSession('agent-1')).rejects.toThrow('Failed to connect');
    });
  });

  describe('getPendingChanges', () => {
    it('returns empty array when no session exists', async () => {
      const changes = await service.getPendingChanges('agent-1');
      expect(changes).toEqual([]);
    });

    it('returns dirty files', async () => {
      const session = await service.getOrCreateSession('agent-1');
      const soul = session.files.get('SOUL.md')!;
      soul.currentContent = '# Soul\nBe very friendly.';
      soul.dirty = true;

      const changes = await service.getPendingChanges('agent-1');
      expect(changes).toHaveLength(1);
      expect(changes[0].filename).toBe('SOUL.md');
      expect(changes[0].originalContent).toBe('# Soul\nBe helpful.');
      expect(changes[0].currentContent).toBe('# Soul\nBe very friendly.');
    });

    it('excludes unchanged files', async () => {
      await service.getOrCreateSession('agent-1');
      const changes = await service.getPendingChanges('agent-1');
      expect(changes).toHaveLength(0);
    });
  });

  describe('syncChanges', () => {
    it('returns zero files when no session exists', async () => {
      const result = await service.syncChanges('agent-1');
      expect(result.syncedFiles).toBe(0);
      expect(result.errors).toContain('No active session found');
    });

    it('returns zero files when no dirty files', async () => {
      await service.getOrCreateSession('agent-1');
      const result = await service.syncChanges('agent-1');
      expect(result.syncedFiles).toBe(0);
      expect(result.failedFiles).toBe(0);
    });

    it('persists dirty files and calls sync engine', async () => {
      const session = await service.getOrCreateSession('agent-1');
      const soul = session.files.get('SOUL.md')!;
      soul.currentContent = '# Soul\nBe very friendly.';
      soul.dirty = true;

      const result = await service.syncChanges('agent-1');

      expect(deps.fileRepo.upsertFile).toHaveBeenCalledWith(
        expect.objectContaining({
          machineId: 'machine-1',
          relativePath: 'workspace/SOUL.md',
          content: '# Soul\nBe very friendly.',
          localDirty: true,
        }),
      );

      expect(deps.syncEngine.executePush).toHaveBeenCalledWith(
        'machine-1',
        expect.any(Object),
        '~/.openclaw',
        'bot-config-agent',
        ['workspace/SOUL.md'],
      );

      expect(result.syncedFiles).toBe(1);
      expect(result.failedFiles).toBe(0);
    });

    it('resets dirty flags on successful sync', async () => {
      const session = await service.getOrCreateSession('agent-1');
      const soul = session.files.get('SOUL.md')!;
      soul.currentContent = '# Soul\nBe very friendly.';
      soul.dirty = true;

      await service.syncChanges('agent-1');

      expect(soul.dirty).toBe(false);
      expect(soul.originalContent).toBe('# Soul\nBe very friendly.');
    });
  });

  describe('resetSession', () => {
    it('returns false when no session exists', () => {
      expect(service.resetSession('agent-1')).toBe(false);
    });

    it('deletes existing session', async () => {
      await service.getOrCreateSession('agent-1');
      expect(service.resetSession('agent-1')).toBe(true);

      // Session should be gone, so getPendingChanges returns empty
      const changes = await service.getPendingChanges('agent-1');
      expect(changes).toEqual([]);
    });
  });

  describe('getSessionInfo', () => {
    it('returns null when no session exists', () => {
      expect(service.getSessionInfo('agent-1')).toBeNull();
    });

    it('returns session metadata', async () => {
      const session = await service.getOrCreateSession('agent-1');
      session.files.get('SOUL.md')!.dirty = true;
      session.messages.push({ role: 'user', content: 'hello' });

      const info = service.getSessionInfo('agent-1');
      expect(info).not.toBeNull();
      expect(info!.fileCount).toBe(2);
      expect(info!.dirtyCount).toBe(1);
      expect(info!.messageCount).toBe(1);
    });
  });
});
