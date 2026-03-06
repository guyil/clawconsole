import type { Job } from 'bullmq';
import type { MachineService } from '../modules/machines/machine.service.js';
import { createChildLogger } from '../shared/logger.js';

const log = createChildLogger('health-check-job');

export function createHealthCheckHandler(machineService: MachineService) {
  return async (_job: Job): Promise<void> => {
    const machines = await machineService.listMachines();

    log.info({ count: machines.length }, 'Running health checks');

    for (const machine of machines) {
      if (machine.status === 'archived' as any) continue;

      try {
        await machineService.healthCheck(machine.id);
      } catch (err) {
        log.error({ machineId: machine.id, err }, 'Health check failed');
      }
    }
  };
}
