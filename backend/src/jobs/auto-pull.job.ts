import type { Job } from 'bullmq';
import type { MachineService } from '../modules/machines/machine.service.js';
import type { SyncEngine } from '../modules/sync/sync-engine.js';
import { createChildLogger } from '../shared/logger.js';

const log = createChildLogger('auto-pull-job');

export function createAutoPullHandler(
  machineService: MachineService,
  syncEngine: SyncEngine,
) {
  return async (_job: Job): Promise<void> => {
    const machines = await machineService.listMachines({ status: 'online' });

    log.info({ count: machines.length }, 'Running auto-pull for online machines');

    for (const machine of machines) {
      try {
        const connInfo = machineService.toConnectionInfo(machine);
        const result = await syncEngine.executePull(
          machine.id,
          connInfo,
          machine.openclawHome,
          'auto-pull',
        );
        log.info(
          { machineId: machine.id, synced: result.syncedFiles, failed: result.failedFiles },
          'Auto-pull completed',
        );
      } catch (err) {
        log.error({ machineId: machine.id, err }, 'Auto-pull failed');
      }
    }
  };
}
