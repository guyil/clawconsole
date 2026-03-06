import type { Job } from 'bullmq';
import type { MonitoringService } from '../modules/monitoring/monitoring.service.js';
import { createChildLogger } from '../shared/logger.js';

const log = createChildLogger('log-collector-job');

export function createLogCollectorHandler(monitoringService: MonitoringService) {
  return async (_job: Job): Promise<void> => {
    log.info('Running log collection for all machines');
    try {
      const collected = await monitoringService.collectAllMachineLogs();
      log.info({ collected }, 'Log collection complete');
    } catch (err) {
      log.error({ err }, 'Log collection failed');
    }
  };
}
