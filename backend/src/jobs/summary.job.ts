import type { Job } from 'bullmq';
import type { SummaryService } from '../modules/summaries/summary.service.js';
import { createChildLogger } from '../shared/logger.js';

const log = createChildLogger('summary-job');

export function createSummaryHandler(service: SummaryService) {
  return async (_job: Job): Promise<void> => {
    if (!service.isGeminiConfigured()) {
      log.warn('Skipping scheduled summary run: GEMINI_API_KEY not configured');
      return;
    }

    log.info('Scheduled summary pass starting');
    const started = Date.now();

    try {
      const results = await service.generateScheduled(new Date());
      const success = results.filter((r) => r.status === 'success').length;
      const empty = results.filter((r) => r.status === 'empty').length;
      const failed = results.filter((r) => r.status === 'failed').length;
      const pushed = results.filter((r) => r.pushed).length;

      log.info(
        { total: results.length, success, empty, failed, pushed, ms: Date.now() - started },
        'Scheduled summary pass complete',
      );
    } catch (err) {
      log.error({ err, ms: Date.now() - started }, 'Scheduled summary pass failed');
    }
  };
}
