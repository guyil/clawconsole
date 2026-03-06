import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { SyncEngine } from './sync-engine.js';
import type { SyncRepository } from './sync.repository.js';
import type { MachineService } from '../machines/machine.service.js';
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
