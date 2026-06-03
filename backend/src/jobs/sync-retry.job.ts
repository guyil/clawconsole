import type { Job } from 'bullmq';
import type { MachineService } from '../modules/machines/machine.service.js';
import type { SyncEngine } from '../modules/sync/sync-engine.js';
import type { SyncRepository } from '../modules/sync/sync.repository.js';
import { createChildLogger } from '../shared/logger.js';

const log = createChildLogger('sync-retry-job');

export function createSyncRetryHandler(
  machineService: MachineService,
  syncEngine: SyncEngine,
  syncRepository: SyncRepository,
) {
  return async (_job: Job): Promise<void> => {
    const retryable = await syncRepository.findRetryableOperations();

    if (retryable.length === 0) return;

    log.info({ count: retryable.length }, 'Retrying failed sync operations');

    for (const operation of retryable) {
      try {
        const machine = await machineService.getMachine(operation.machineId);
        if (machine.status !== 'online') {
          log.debug(
            { operationId: operation.id, machineId: machine.id, status: machine.status },
            'Skipping sync retry: machine not online',
          );
          continue;
        }
        const connInfo = machineService.toConnectionInfo(machine);
        await syncRepository.incrementRetryCount(operation.id);

        await syncEngine.executePush(
          operation.machineId,
          connInfo,
          machine.openclawHome,
          'system-retry',
        );

        log.info({ operationId: operation.id }, 'Retry succeeded');
      } catch (err) {
        log.error({ operationId: operation.id, err }, 'Retry failed');
      }
    }
  };
}
