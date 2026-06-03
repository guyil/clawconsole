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
        // Re-read status before each SSH-heavy pull. Health-check may flip
        // a machine to offline mid-loop, and we don't want to keep hammering
        // an unreachable host with 60s SSH timeouts.
        const fresh = await machineService.getMachine(machine.id);
        if (fresh.status !== 'online') {
          log.debug({ machineId: machine.id, status: fresh.status }, 'Skipping auto-pull: not online');
          continue;
        }

        const connInfo = machineService.toConnectionInfo(fresh);
        const result = await syncEngine.executePull(
          machine.id,
          connInfo,
          fresh.openclawHome,
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
