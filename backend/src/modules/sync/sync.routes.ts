import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { SyncEngine } from './sync-engine.js';
import type { SyncRepository } from './sync.repository.js';
import type { MachineService } from '../machines/machine.service.js';
import type { AgentRepository } from '../agents/agent.repository.js';
import { AppError } from '../../shared/errors.js';

const PushSyncSchema = z.object({
  files: z.array(z.string()).optional(),
  forceSyncMode: z.enum(['hot', 'warm', 'cold']).optional(),
  skipVerification: z.boolean().optional(),
}).optional();

export function registerSyncRoutes(
  fastify: FastifyInstance,
  syncEngine: SyncEngine,
  syncRepository: SyncRepository,
  machineService: MachineService,
  agentRepo: AgentRepository,
) {
  fastify.post('/api/machines/:machineId/sync/pull', async (request) => {
    const { machineId } = request.params as { machineId: string };
    const machine = await machineService.getMachine(machineId);
    const connInfo = machineService.toConnectionInfo(machine);

    return syncEngine.executePull(machineId, connInfo, machine.openclawHome, 'api-user');
  });

  fastify.get('/api/machines/:machineId/sync/plan', async (request) => {
    const { machineId } = request.params as { machineId: string };
    const machine = await machineService.getMachine(machineId);
    const connInfo = machineService.toConnectionInfo(machine);

    const { plan } = await syncEngine.buildSyncPlan(machineId, connInfo, machine.openclawHome);
    return {
      syncMode: plan.mode,
      filesToPush: plan.filesToPush.map((f) => ({
        path: f.relativePath,
        action: f.action,
      })),
      filesToPull: plan.filesToPull.map((f) => ({
        path: f.relativePath,
        action: f.action,
        remoteHash: f.remoteHash,
        sizeBytes: f.remoteSize,
      })),
      conflicts: plan.conflicts.map((c) => ({
        path: c.relativePath,
        localHash: c.localHash,
        remoteHash: c.remoteHash,
      })),
      requiresRestart: plan.requiresRestart,
      estimatedDurationMs: plan.estimatedDurationMs,
    };
  });

  fastify.post('/api/machines/:machineId/sync/push', async (request) => {
    const { machineId } = request.params as { machineId: string };
    const body = PushSyncSchema.parse(request.body ?? {});

    // Developers (authScope present) may push, but only their own assigned
    // bots' files on this node. The authz layer already verified the machine
    // is in scope; here we ensure every pushed file lives under one of the
    // developer's assigned bots' workspaces, and forbid the "push everything
    // dirty" form so they can't sweep up another bot's pending edits.
    if (request.authScope) {
      const files = body?.files ?? [];
      if (files.length === 0) {
        throw new AppError('Developers must specify which files to push', 'FORBIDDEN', 403);
      }
      const assigned = await Promise.all(
        request.authScope.agentUuids.map((id) => agentRepo.findById(id)),
      );
      const allowedPrefixes = assigned
        .filter((a): a is NonNullable<typeof a> => a != null && a.machineId === machineId)
        .map((a) => `${a.workspacePath ?? 'workspace'}/`);
      const outOfScope = files.filter((f) => !allowedPrefixes.some((p) => f.startsWith(p)));
      if (outOfScope.length > 0) {
        throw new AppError('One or more files are outside your assigned bots', 'FORBIDDEN', 403);
      }
    }

    const machine = await machineService.getMachine(machineId);
    const connInfo = machineService.toConnectionInfo(machine);

    return syncEngine.executePush(
      machineId,
      connInfo,
      machine.openclawHome,
      'api-user',
      body?.files,
    );
  });

  fastify.post('/api/machines/:machineId/sync/full', async (request) => {
    const { machineId } = request.params as { machineId: string };
    const machine = await machineService.getMachine(machineId);
    const connInfo = machineService.toConnectionInfo(machine);

    return syncEngine.fullSync(machineId, connInfo, machine.openclawHome, 'api-user');
  });

  fastify.get('/api/machines/:machineId/sync/operations', async (request) => {
    const { machineId } = request.params as { machineId: string };
    const query = request.query as Record<string, string>;
    const operations = await syncRepository.findOperationsByMachine(machineId, {
      status: query.status as any,
      limit: parseInt(query.pageSize ?? '20', 10),
      offset: (parseInt(query.page ?? '1', 10) - 1) * parseInt(query.pageSize ?? '20', 10),
    });
    return { data: operations, total: operations.length };
  });

  fastify.get('/api/sync/operations/:operationId', async (request) => {
    const { operationId } = request.params as { operationId: string };
    const operation = await syncRepository.findOperationById(operationId);
    if (!operation) throw new AppError('Sync operation not found', 'NOT_FOUND', 404);
    const files = await syncRepository.getOperationFiles(operationId);
    return { ...operation, files };
  });

  fastify.post('/api/sync/operations/:operationId/retry', async (request) => {
    const { operationId } = request.params as { operationId: string };
    const operation = await syncRepository.findOperationById(operationId);
    if (!operation) throw new AppError('Sync operation not found', 'NOT_FOUND', 404);
    if (!['partial_failure', 'failed'].includes(operation.status)) {
      throw new AppError('Only failed operations can be retried', 'INVALID_STATE', 400);
    }

    const machine = await machineService.getMachine(operation.machineId);
    const connInfo = machineService.toConnectionInfo(machine);
    await syncRepository.incrementRetryCount(operationId);

    return syncEngine.executePush(
      operation.machineId,
      connInfo,
      machine.openclawHome,
      'api-user-retry',
    );
  });
}
