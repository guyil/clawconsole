import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FileTransfer } from '../../../src/transport/file-transfer.js';
import type { SSHConnectionInfo } from '../../../src/transport/ssh-pool.js';

vi.mock('../../../src/shared/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  }),
}));

const connInfo: SSHConnectionInfo = {
  machineId: 'machine-1',
  host: 'node-1',
  port: 22,
  username: 'claw',
};

function createMockSftp() {
  const writeChunks: string[] = [];
  const writeStream = {
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      if (event === 'close') setTimeout(() => cb(), 0);
      return writeStream;
    }),
    end: vi.fn((content: string) => {
      writeChunks.push(content);
    }),
  };

  const readStream = {
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      if (event === 'data') setTimeout(() => cb('file content'), 0);
      if (event === 'end') setTimeout(() => cb(), 10);
      return readStream;
    }),
  };

  return {
    createWriteStream: vi.fn().mockReturnValue(writeStream),
    createReadStream: vi.fn().mockReturnValue(readStream),
    stat: vi.fn((_path: string, cb: (err: Error | null) => void) => cb(null)),
    end: vi.fn(),
    writeStream,
    writeChunks,
  };
}

function createMockPool(homeDir = '/home/claw') {
  const mockSftp = createMockSftp();
  const mockClient = {
    sftp: vi.fn((cb: (err: Error | null, sftp: unknown) => void) => {
      cb(null, mockSftp);
    }),
  };

  const pool = {
    getConnection: vi.fn().mockResolvedValue(mockClient),
    releaseConnection: vi.fn(),
    executeCommand: vi.fn().mockImplementation(
      (_info: SSHConnectionInfo, command: string) => {
        if (command === 'echo $HOME') {
          return Promise.resolve({ stdout: `${homeDir}\n`, stderr: '', exitCode: 0 });
        }
        return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 });
      },
    ),
  };

  return { pool, mockClient, mockSftp };
}

describe('FileTransfer', () => {
  describe('tilde path resolution', () => {
    let ft: FileTransfer;
    let pool: ReturnType<typeof createMockPool>['pool'];
    let mockSftp: ReturnType<typeof createMockSftp>;

    beforeEach(() => {
      const mocks = createMockPool('/home/claw');
      pool = mocks.pool;
      mockSftp = mocks.mockSftp;
      ft = new FileTransfer(pool as any);
    });

    it('resolves ~ to actual home directory in ensureDirectory', async () => {
      await ft.ensureDirectory(connInfo, '~/.openclaw/workspace-pm/skills/test');

      expect(pool.executeCommand).toHaveBeenCalledWith(
        connInfo,
        'echo $HOME',
        expect.any(Object),
      );
      expect(pool.executeCommand).toHaveBeenCalledWith(
        connInfo,
        expect.stringContaining('/home/claw/.openclaw/workspace-pm/skills/test'),
        expect.any(Object),
      );
      // Must NOT contain literal ~ in the mkdir command
      const mkdirCall = pool.executeCommand.mock.calls.find(
        (c: unknown[]) => (c[1] as string).includes('mkdir'),
      );
      expect(mkdirCall).toBeDefined();
      expect(mkdirCall![1]).not.toContain("'~/");
    });

    it('resolves ~ to actual home directory in uploadFile', async () => {
      await ft.uploadFile(
        connInfo,
        '~/.openclaw/workspace-pm/skills/test/SKILL.md',
        '# Content',
      );

      // SFTP createWriteStream must receive resolved absolute path
      expect(mockSftp.createWriteStream).toHaveBeenCalledWith(
        '/home/claw/.openclaw/workspace-pm/skills/test/SKILL.md',
        expect.any(Object),
      );
    });

    it('resolves ~ to actual home directory in deleteFile', async () => {
      await ft.deleteFile(connInfo, '~/.openclaw/skills/test/SKILL.md');

      const rmCall = pool.executeCommand.mock.calls.find(
        (c: unknown[]) => (c[1] as string).includes('rm'),
      );
      expect(rmCall).toBeDefined();
      expect(rmCall![1]).toContain('/home/claw/.openclaw/skills/test/SKILL.md');
      expect(rmCall![1]).not.toContain("'~/");
    });

    it('passes absolute paths unchanged', async () => {
      await ft.ensureDirectory(connInfo, '/opt/openclaw/skills/test');

      // Should NOT call echo $HOME for absolute paths
      const homeCall = pool.executeCommand.mock.calls.find(
        (c: unknown[]) => (c[1] as string) === 'echo $HOME',
      );
      expect(homeCall).toBeUndefined();

      const mkdirCall = pool.executeCommand.mock.calls.find(
        (c: unknown[]) => (c[1] as string).includes('mkdir'),
      );
      expect(mkdirCall![1]).toContain('/opt/openclaw/skills/test');
    });

    it('caches home directory per machine', async () => {
      await ft.ensureDirectory(connInfo, '~/.openclaw/skills/a');
      await ft.ensureDirectory(connInfo, '~/.openclaw/skills/b');

      const homeCalls = pool.executeCommand.mock.calls.filter(
        (c: unknown[]) => (c[1] as string) === 'echo $HOME',
      );
      // Should only resolve home once per machine
      expect(homeCalls).toHaveLength(1);
    });

    it('resolves ~ for different machines independently', async () => {
      const conn2: SSHConnectionInfo = { ...connInfo, machineId: 'machine-2' };
      const mocks2 = createMockPool('/root');
      const ft2 = new FileTransfer(mocks2.pool as any);

      await ft2.ensureDirectory(connInfo, '~/.openclaw/skills/a');
      await ft2.ensureDirectory(conn2, '~/.openclaw/skills/b');

      const homeCalls = mocks2.pool.executeCommand.mock.calls.filter(
        (c: unknown[]) => (c[1] as string) === 'echo $HOME',
      );
      expect(homeCalls).toHaveLength(2);
    });

    it('resolves ~ in getRemoteFileHash', async () => {
      pool.executeCommand.mockImplementation(
        (_info: SSHConnectionInfo, command: string) => {
          if (command === 'echo $HOME') {
            return Promise.resolve({ stdout: '/home/claw\n', stderr: '', exitCode: 0 });
          }
          return Promise.resolve({
            stdout: 'abc123def456abc123def456abc123def456abc123def456abc123def456abc12345\n',
            stderr: '',
            exitCode: 0,
          });
        },
      );

      await ft.getRemoteFileHash(connInfo, '~/.openclaw/skills/test/SKILL.md');

      const hashCall = pool.executeCommand.mock.calls.find(
        (c: unknown[]) => (c[1] as string).includes('sha256sum'),
      );
      expect(hashCall).toBeDefined();
      expect(hashCall![1]).toContain('/home/claw/.openclaw/skills/test/SKILL.md');
    });
  });
});
