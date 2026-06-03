/**
 * Read-only client for the daily-OSS-backup status endpoint.
 *
 * Backend endpoint: ``GET /api/distill/push-to-oss/status``
 * Defined in: ``backend/src/modules/distill-push/distill-push.routes.ts``
 *
 * Cheap to poll (one DB list + a few BullMQ ZRANGEs); the BotsPage
 * dashboard refreshes every 60s so users see "上次蒸馏: 15 分钟前 ✅"
 * without leaving the page.
 */
import { api } from './client';
import type { DistillStatus } from '../types/distill-status';

export const distillStatusApi = {
  get: (recentRuns?: number) =>
    api
      .get<DistillStatus>('/distill/push-to-oss/status', {
        params: typeof recentRuns === 'number' ? { recentRuns } : undefined,
      })
      .then((r) => r.data),
};
