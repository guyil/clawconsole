import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../src/shared/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  }),
}));

vi.mock('../../../src/config/index.js', () => ({
  config: {
    ssh: {
      maxConnectionsPerMachine: 2,
      idleTimeoutMs: 300_000,
      connectionTimeoutMs: 10_000,
      queueTimeoutMs: 5_000,
      maxQueueSize: 3,
    },
  },
}));

import { SSHPool } from '../../../src/transport/ssh-pool.js';
import type { SSHConnectionInfo } from '../../../src/transport/ssh-pool.js';

const connInfo: SSHConnectionInfo = {
  machineId: 'machine-1',
  host: 'node-1',
  port: 22,
  username: 'claw',
};

function createFakeClient(id: string) {
  return {
    _id: id,
    _sock: { writable: true },
    exec: vi.fn((cmd: string, cb: (err: Error | null, stream: unknown) => void) => {
      const stream = {
        on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
          if (event === 'data') setTimeout(() => handler(Buffer.from('ok')), 0);
          if (event === 'close') setTimeout(() => handler(0), 5);
          return stream;
        }),
        stderr: {
          on: vi.fn().mockReturnThis(),
        },
      };
      cb(null, stream);
    }),
    end: vi.fn(),
    on: vi.fn().mockReturnThis(),
    connect: vi.fn(),
  };
}

describe('SSHPool', () => {
  let pool: SSHPool;
  let clientIdCounter = 0;

  beforeEach(() => {
    clientIdCounter = 0;
    pool = new SSHPool();

    // Stub createConnection to return mock clients
    vi.spyOn(pool as any, 'createConnection').mockImplementation(async () => {
      const client = createFakeClient(`client-${++clientIdCounter}`);
      return client;
    });
  });

  afterEach(async () => {
    await pool.destroy();
  });

  describe('basic pooling', () => {
    it('creates a new connection when pool is empty', async () => {
      const client = await pool.getConnection(connInfo);
      expect(client).toBeDefined();
      expect((pool as any).createConnection).toHaveBeenCalledTimes(1);
      pool.releaseConnection(connInfo.machineId, client);
    });

    it('reuses idle connection', async () => {
      const client1 = await pool.getConnection(connInfo);
      pool.releaseConnection(connInfo.machineId, client1);

      const client2 = await pool.getConnection(connInfo);
      expect(client2).toBe(client1);
      expect((pool as any).createConnection).toHaveBeenCalledTimes(1);
      pool.releaseConnection(connInfo.machineId, client2);
    });

    it('creates second connection when first is in use', async () => {
      const client1 = await pool.getConnection(connInfo);
      const client2 = await pool.getConnection(connInfo);
      expect(client1).not.toBe(client2);
      expect((pool as any).createConnection).toHaveBeenCalledTimes(2);
      pool.releaseConnection(connInfo.machineId, client1);
      pool.releaseConnection(connInfo.machineId, client2);
    });
  });

  describe('queue behavior', () => {
    it('queues request when all connections are in use instead of throwing', async () => {
      const client1 = await pool.getConnection(connInfo);
      const client2 = await pool.getConnection(connInfo);

      // Third request should queue, not throw
      const queuedPromise = pool.getConnection(connInfo);

      // Release one connection to unblock the queued request
      pool.releaseConnection(connInfo.machineId, client1);

      const client3 = await queuedPromise;
      expect(client3).toBe(client1);

      pool.releaseConnection(connInfo.machineId, client2);
      pool.releaseConnection(connInfo.machineId, client3);
    });

    it('processes queued requests in FIFO order', async () => {
      const client1 = await pool.getConnection(connInfo);
      const client2 = await pool.getConnection(connInfo);

      const results: string[] = [];
      const p1 = pool.getConnection(connInfo).then((c) => {
        results.push('first');
        return c;
      });
      const p2 = pool.getConnection(connInfo).then((c) => {
        results.push('second');
        return c;
      });

      // Release client1 first
      pool.releaseConnection(connInfo.machineId, client1);
      const r1 = await p1;

      // Release client2
      pool.releaseConnection(connInfo.machineId, client2);
      const r2 = await p2;

      expect(results).toEqual(['first', 'second']);

      pool.releaseConnection(connInfo.machineId, r1);
      pool.releaseConnection(connInfo.machineId, r2);
    });

    it('rejects queued request after queue timeout', async () => {
      const client1 = await pool.getConnection(connInfo);
      const client2 = await pool.getConnection(connInfo);

      // Queue a request — queueTimeoutMs is 5000 in our mock config
      const queuedPromise = pool.getConnection(connInfo);

      await expect(queuedPromise).rejects.toThrow(/timed out waiting/i);

      pool.releaseConnection(connInfo.machineId, client1);
      pool.releaseConnection(connInfo.machineId, client2);
    }, 10_000);

    it('rejects when queue is full', async () => {
      const client1 = await pool.getConnection(connInfo);
      const client2 = await pool.getConnection(connInfo);

      // Queue 3 requests (maxQueueSize = 3 in mock config)
      const queued = [
        pool.getConnection(connInfo),
        pool.getConnection(connInfo),
        pool.getConnection(connInfo),
      ];

      // 4th request should be rejected immediately (queue full)
      await expect(pool.getConnection(connInfo)).rejects.toThrow(/queue is full/i);

      // Clean up: release connections to resolve queued requests
      pool.releaseConnection(connInfo.machineId, client1);
      pool.releaseConnection(connInfo.machineId, client2);

      const r1 = await queued[0];
      pool.releaseConnection(connInfo.machineId, r1);
      const r2 = await queued[1];
      pool.releaseConnection(connInfo.machineId, r2);
      const r3 = await queued[2];
      pool.releaseConnection(connInfo.machineId, r3);
    });
  });

  describe('executeCommand with queue', () => {
    it('waits in queue and executes command successfully', async () => {
      const client1 = await pool.getConnection(connInfo);
      const client2 = await pool.getConnection(connInfo);

      // Start a command that will queue
      const cmdPromise = pool.executeCommand(connInfo, 'echo hello');

      // Release a connection to let the command proceed
      pool.releaseConnection(connInfo.machineId, client1);

      const result = await cmdPromise;
      expect(result.stdout).toContain('ok');

      pool.releaseConnection(connInfo.machineId, client2);
    });
  });

  describe('destroy', () => {
    it('rejects all queued requests on destroy', async () => {
      const client1 = await pool.getConnection(connInfo);
      const client2 = await pool.getConnection(connInfo);

      const queuedPromise = pool.getConnection(connInfo);

      await pool.destroy();

      await expect(queuedPromise).rejects.toThrow(/pool destroyed/i);

      // client1 and client2 are already ended by destroy
    });
  });
});
