import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { MonitoringService } from './monitoring.service.js';
import type { LogSource } from './monitoring.types.js';

const SessionListSchema = z.object({
  machineId: z.string().uuid().optional(),
  agentId: z.string().optional(),
  channel: z.string().optional(),
  activeMinutes: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const TranscriptSchema = z.object({
  machineId: z.string().uuid(),
  sessionId: z.string().min(1),
  agentId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const LogListSchema = z.object({
  machineId: z.string().uuid().optional(),
  logSource: z.enum(['gateway', 'command', 'config_audit', 'cron_run']).optional(),
  level: z.string().optional(),
  sessionKey: z.string().optional(),
  agentId: z.string().optional(),
  since: z.string().optional(),
  query: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const EventListSchema = z.object({
  machineId: z.string().uuid().optional(),
  eventType: z.string().optional(),
  sessionKey: z.string().optional(),
  since: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const UsageSummarySchema = z.object({
  machineId: z.string().uuid().optional(),
  agentId: z.string().optional(),
});

export function registerMonitoringRoutes(fastify: FastifyInstance, service: MonitoringService) {
  // ─── Sessions ────────────────────────────────────────────────────

  fastify.get('/api/monitoring/sessions', async (request) => {
    const filters = SessionListSchema.parse(request.query);
    return service.listSessions(filters);
  });

  fastify.get('/api/monitoring/sessions/detail', async (request) => {
    const { machineId, sessionKey } = request.query as { machineId: string; sessionKey: string };
    if (!machineId || !sessionKey) {
      return { error: 'machineId and sessionKey are required', code: 'VALIDATION_ERROR' };
    }
    const snapshot = await service.getSessionByKey(machineId, sessionKey);
    if (!snapshot) {
      return { error: 'Session not found', code: 'NOT_FOUND' };
    }
    return snapshot;
  });

  fastify.get('/api/monitoring/sessions/transcript', async (request) => {
    const filters = TranscriptSchema.parse(request.query);
    return service.getSessionTranscript(filters);
  });

  // ─── Logs ────────────────────────────────────────────────────────

  fastify.get('/api/monitoring/logs', async (request) => {
    const filters = LogListSchema.parse(request.query);
    return service.listLogs({
      ...filters,
      logSource: filters.logSource as LogSource | undefined,
    });
  });

  // ─── Diagnostic Events ──────────────────────────────────────────

  fastify.get('/api/monitoring/events', async (request) => {
    const filters = EventListSchema.parse(request.query);
    return service.listDiagnosticEvents(filters);
  });

  // ─── Usage ───────────────────────────────────────────────────────

  fastify.get('/api/monitoring/usage', async (request) => {
    const filters = UsageSummarySchema.parse(request.query);
    const summaries = await service.getUsageSummary(filters);
    return { data: summaries };
  });

  // ─── Dashboard ───────────────────────────────────────────────────

  fastify.get('/api/monitoring/dashboard', async (request) => {
    const { machineId } = request.query as { machineId?: string };
    return service.getDashboard(machineId);
  });

  // ─── Sync Triggers ───────────────────────────────────────────────

  fastify.post('/api/monitoring/sync/sessions', async (request) => {
    const { machineId } = request.body as { machineId: string };
    if (!machineId) {
      return { error: 'machineId is required', code: 'VALIDATION_ERROR' };
    }
    return service.triggerSessionSync(machineId);
  });

  fastify.post('/api/monitoring/sync/transcript', async (request) => {
    const { machineId, sessionKey, agentId } = request.body as {
      machineId: string;
      sessionKey: string;
      agentId: string;
    };
    if (!machineId || !sessionKey || !agentId) {
      return { error: 'machineId, sessionKey, and agentId are required', code: 'VALIDATION_ERROR' };
    }
    return service.triggerTranscriptPull(machineId, sessionKey, agentId);
  });

  fastify.post('/api/monitoring/sync/logs', async (request) => {
    const { machineId } = request.body as { machineId: string };
    if (!machineId) {
      return { error: 'machineId is required', code: 'VALIDATION_ERROR' };
    }
    return service.triggerLogCollection(machineId);
  });
}
