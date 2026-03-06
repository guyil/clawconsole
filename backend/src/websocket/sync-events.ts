import type { WebSocket } from '@fastify/websocket';
import { getRedis, getRedisSubscriber } from '../shared/redis.js';
import { createChildLogger } from '../shared/logger.js';

const log = createChildLogger('sync-events');

export type SyncEventType =
  | 'sync:started'
  | 'sync:progress'
  | 'sync:completed'
  | 'sync:conflict'
  | 'machine:status'
  | 'agent:status'
  | 'job:health-check'
  | 'session:updated'
  | 'session:message'
  | 'session:state'
  | 'log:entry'
  | 'diagnostic:event'
  | 'agent:usage';

export interface SyncEvent {
  type: SyncEventType;
  timestamp: string;
  payload: Record<string, unknown>;
}

const CHANNEL = 'clawconsole:events';

const connectedClients = new Set<WebSocket>();

export function addClient(ws: WebSocket): void {
  connectedClients.add(ws);
  log.info({ clientCount: connectedClients.size }, 'WebSocket client connected');

  ws.on('close', () => {
    connectedClients.delete(ws);
    log.info({ clientCount: connectedClients.size }, 'WebSocket client disconnected');
  });

  ws.on('error', (err) => {
    log.error({ err }, 'WebSocket client error');
    connectedClients.delete(ws);
  });
}

export function broadcastToClients(event: SyncEvent): void {
  const message = JSON.stringify(event);
  for (const ws of connectedClients) {
    if (ws.readyState === 1) {
      ws.send(message);
    }
  }
}

export async function publishEvent(event: SyncEvent): Promise<void> {
  const redis = getRedis();
  await redis.publish(CHANNEL, JSON.stringify(event));
}

export async function startEventSubscriber(): Promise<void> {
  const subscriber = getRedisSubscriber();
  await subscriber.subscribe(CHANNEL);

  subscriber.on('message', (_channel: string, message: string) => {
    try {
      const event = JSON.parse(message) as SyncEvent;
      broadcastToClients(event);
    } catch (err) {
      log.error({ err }, 'Failed to parse event message');
    }
  });

  log.info('Event subscriber started');
}

export function emitSyncStarted(params: {
  operationId: string;
  machineId: string;
  syncType: string;
  direction: string;
}): void {
  publishEvent({
    type: 'sync:started',
    timestamp: new Date().toISOString(),
    payload: params,
  });
}

export function emitSyncProgress(params: {
  operationId: string;
  file: string;
  action: string;
  status: string;
  current: number;
  total: number;
}): void {
  publishEvent({
    type: 'sync:progress',
    timestamp: new Date().toISOString(),
    payload: params,
  });
}

export function emitSyncCompleted(params: {
  operationId: string;
  status: string;
  syncMode: string;
  syncedFiles: number;
  failedFiles: number;
  durationMs: number;
}): void {
  publishEvent({
    type: 'sync:completed',
    timestamp: new Date().toISOString(),
    payload: params,
  });
}

export function emitSyncConflict(params: {
  operationId: string;
  conflicts: Array<{ path: string; localHash: string; remoteHash: string }>;
}): void {
  publishEvent({
    type: 'sync:conflict',
    timestamp: new Date().toISOString(),
    payload: params,
  });
}

export function emitMachineStatus(params: {
  machineId: string;
  status: string;
  checkedAt: string;
}): void {
  publishEvent({
    type: 'machine:status',
    timestamp: new Date().toISOString(),
    payload: params,
  });
}

export function emitAgentStatus(params: {
  agentId: string;
  status: string;
}): void {
  publishEvent({
    type: 'agent:status',
    timestamp: new Date().toISOString(),
    payload: params,
  });
}

// ─── Monitoring Events ─────────────────────────────────────────────

export function emitSessionUpdated(params: {
  machineId: string;
  agentId: string;
  sessionKey: string;
  sessionId?: string;
  channel?: string;
  totalTokens?: number;
}): void {
  publishEvent({
    type: 'session:updated',
    timestamp: new Date().toISOString(),
    payload: params,
  });
}

export function emitSessionMessage(params: {
  machineId: string;
  agentId: string;
  sessionId: string;
  role: string;
  contentPreview?: string;
}): void {
  publishEvent({
    type: 'session:message',
    timestamp: new Date().toISOString(),
    payload: params,
  });
}

export function emitSessionState(params: {
  machineId: string;
  sessionKey: string;
  state: string;
  prevState?: string;
}): void {
  publishEvent({
    type: 'session:state',
    timestamp: new Date().toISOString(),
    payload: params,
  });
}

export function emitLogEntry(params: {
  machineId: string;
  logSource: string;
  level: string;
  message: string;
}): void {
  publishEvent({
    type: 'log:entry',
    timestamp: new Date().toISOString(),
    payload: params,
  });
}

export function emitDiagnosticEventToClient(params: {
  machineId: string;
  eventType: string;
  sessionKey?: string;
  outcome?: string;
}): void {
  publishEvent({
    type: 'diagnostic:event',
    timestamp: new Date().toISOString(),
    payload: params,
  });
}

export function emitAgentUsage(params: {
  machineId: string;
  agentId: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}): void {
  publishEvent({
    type: 'agent:usage',
    timestamp: new Date().toISOString(),
    payload: params,
  });
}
