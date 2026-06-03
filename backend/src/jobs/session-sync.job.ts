import type { Job } from 'bullmq';
import type { MonitoringService } from '../modules/monitoring/monitoring.service.js';
import { createChildLogger } from '../shared/logger.js';

const log = createChildLogger('session-sync-job');

export function createSessionSyncHandler(monitoringService: MonitoringService) {
  return async (_job: Job): Promise<void> => {
    log.info('Running session sync for all machines');
    try {
      const result = await monitoringService.syncAllMachineSessions();
      log.info(result, 'Session sync complete');
    } catch (err) {
      log.error({ err }, 'Session sync failed');
    }
  };
}
