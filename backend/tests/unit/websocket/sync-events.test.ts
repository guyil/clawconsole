import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/shared/redis.js', () => ({
  getRedis: vi.fn(() => ({
    publish: vi.fn().mockResolvedValue(1),
  })),
  getRedisSubscriber: vi.fn(() => ({
    subscribe: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  })),
}));

vi.mock('../../../src/shared/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  }),
}));

import {
  broadcastToClients,
  addClient,
  type SyncEvent,
} from '../../../src/websocket/sync-events.js';

function createMockWs(readyState = 1) {
  return {
    readyState,
    send: vi.fn(),
    on: vi.fn(),
  } as any;
}

describe('sync-events', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('broadcastToClients', () => {
    it('sends JSON to connected clients with readyState OPEN', () => {
      const ws = createMockWs(1);
      addClient(ws);

      const event: SyncEvent = {
        type: 'sync:started',
        timestamp: '2026-03-06T00:00:00.000Z',
        payload: { operationId: 'op-1', machineId: 'm-1' },
      };

      broadcastToClients(event);

      expect(ws.send).toHaveBeenCalledWith(JSON.stringify(event));
    });

    it('skips clients with non-OPEN readyState', () => {
      const ws = createMockWs(3);
      addClient(ws);

      const event: SyncEvent = {
        type: 'sync:completed',
        timestamp: '2026-03-06T00:00:00.000Z',
        payload: { operationId: 'op-1', status: 'completed' },
      };

      broadcastToClients(event);

      expect(ws.send).not.toHaveBeenCalled();
    });
  });

  describe('addClient', () => {
    it('registers close and error event handlers', () => {
      const ws = createMockWs(1);
      addClient(ws);

      expect(ws.on).toHaveBeenCalledWith('close', expect.any(Function));
      expect(ws.on).toHaveBeenCalledWith('error', expect.any(Function));
    });

    it('removes client on close', () => {
      const ws = createMockWs(1);
      addClient(ws);

      const closeHandler = ws.on.mock.calls.find((c: any[]) => c[0] === 'close')?.[1];
      expect(closeHandler).toBeDefined();
      closeHandler();

      const event: SyncEvent = {
        type: 'sync:started',
        timestamp: '2026-03-06T00:00:00.000Z',
        payload: {},
      };
      broadcastToClients(event);

      expect(ws.send).not.toHaveBeenCalled();
    });

    it('removes client on error', () => {
      const ws = createMockWs(1);
      addClient(ws);

      const errorHandler = ws.on.mock.calls.find((c: any[]) => c[0] === 'error')?.[1];
      expect(errorHandler).toBeDefined();
      errorHandler(new Error('connection reset'));

      const event: SyncEvent = {
        type: 'sync:started',
        timestamp: '2026-03-06T00:00:00.000Z',
        payload: {},
      };
      broadcastToClients(event);

      expect(ws.send).not.toHaveBeenCalled();
    });
  });
});
