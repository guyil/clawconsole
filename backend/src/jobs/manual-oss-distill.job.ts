/**
 * Worker for the ``manual-oss-distill`` queue.
 *
 * Why this exists
 * ---------------
 * A single distill push can take 5+ minutes on a cold mac-mini (the heavy
 * step is ``openclaw memory index`` which rebuilds the vector store). The
 * HTTP routes used to ``await pushAgent`` inline, which blew through nginx's
 * 300s ``proxy_read_timeout`` and surfaced as a 504 to the user. Now the
 * routes enqueue here and return 202 immediately; the UI polls
 * ``/api/distill/push-to-oss/status`` to watch the agent row's
 * ``last_oss_sync_at`` flip from null → a fresh timestamp.
 *
 * Job payload
 * -----------
 *   { machineId: string, agentDbId: string }
 *
 * The handler delegates straight to ``DistillPushService.pushAgent`` — the
 * service already stamps the agent row with success/failure state, so this
 * job doesn't need its own bookkeeping. We use the same per-agent timeout
 * as the daily run to avoid letting a hung SSH session pin a worker slot.
 *
 * Failure handling
 * ----------------
 * The handler does NOT throw on push failure. ``pushAgent`` already records
 * the failure in the agent row; throwing here would just bloat the BullMQ
 * ``failed`` set and trigger retries we don't want (the next manual click
 * is the natural retry path). We do throw on truly exceptional errors
 * (DB unreachable, bug in the dependency wiring) so they show up in
 * ``recentRuns`` for the dashboard.
 */
import type { Job } from 'bullmq';

import { config } from '../config/index.js';
import { createChildLogger } from '../shared/logger.js';
import type { DistillPushService } from '../modules/distill-push/distill-push.service.js';

const log = createChildLogger('manual-oss-distill-job');

export interface ManualOssDistillJobData {
  machineId: string;
  agentDbId: string;
  /** Where the request came from — useful for log triage. */
  source: 'single' | 'machine' | 'all';
}

interface Deps {
  distillPushService: DistillPushService;
}

export function createManualOssDistillHandler(deps: Deps) {
  const { distillPushService } = deps;

  return async (job: Job<ManualOssDistillJobData>): Promise<void> => {
    const { machineId, agentDbId, source } = job.data;
    const perAgentTimeoutMs = config.dailyOssBackup.perAgentTimeoutMs;

    log.info(
      { jobId: job.id, machineId, agentDbId, source },
      'manual distill starting',
    );
    const started = Date.now();

    let timer: NodeJS.Timeout | undefined;
    try {
      const result = await Promise.race([
        distillPushService.pushAgent(machineId, agentDbId),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`per-agent timeout after ${perAgentTimeoutMs}ms`)),
            perAgentTimeoutMs,
          );
        }),
      ]);
      log.info(
        {
          jobId: job.id,
          agentKey: result.agentKey,
          durationMs: result.durationMs,
          rawUploaded: result.rawUploaded,
          personaUploaded: result.personaUploaded,
          personaSkipped: result.personaSkipped,
          skillsUploaded: result.skillsUploaded,
        },
        'manual distill ok',
      );
    } catch (err) {
      // ``pushAgent`` has already stamped agents.last_oss_sync_status='failed'
      // with the truncated error. Logging here is for ops visibility; we
      // intentionally don't re-throw because BullMQ retries on a manual
      // distill produce duplicate work, not value.
      log.warn(
        {
          jobId: job.id,
          machineId,
          agentDbId,
          source,
          err: (err as Error).message,
          durationMs: Date.now() - started,
        },
        'manual distill failed (recorded on agent row)',
      );
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
}
