/**
 * React Query hook for the OSS distill backup dashboard.
 *
 * Polls every 60s when idle — cheap on the backend (no SSH, no OSS;
 * just a DB list + a few BullMQ ZRANGEs against Redis) so the BotsPage
 * can keep "下次执行" / "上次同步" badges live without a websocket.
 *
 * When there are in-flight manual distill jobs, the cadence auto-bumps
 * to ``activeIntervalMs`` (default 5s) so the user sees agents flip
 * waiting → active → ok within a few seconds of each transition.
 */
import { useQuery } from '@tanstack/react-query';
import { distillStatusApi } from '../api/distill-status.api';

export const distillStatusKeys = {
  all: ['distill-status'] as const,
  detail: (recentRuns?: number) => [...distillStatusKeys.all, recentRuns ?? 5] as const,
};

export function useDistillStatus(options?: {
  recentRuns?: number;
  /** ms when no jobs are in flight. Default 60_000. ``false`` disables polling. */
  refetchIntervalMs?: number | false;
  /** ms when at least one job is waiting/active. Default 5_000. */
  activeIntervalMs?: number;
  /** When false, the query is paused (e.g. modal closed). */
  enabled?: boolean;
}) {
  const recent = options?.recentRuns;
  const idleInterval = options?.refetchIntervalMs;
  const activeInterval = options?.activeIntervalMs ?? 5_000;
  return useQuery({
    queryKey: distillStatusKeys.detail(recent),
    queryFn: () => distillStatusApi.get(recent),
    // React Query lets ``refetchInterval`` be a function of the latest
    // data, which is exactly the right hook for "poll faster while
    // distill jobs are flowing." When the queue drains, the next
    // tick reverts to the idle cadence on its own.
    refetchInterval: (query) => {
      if (idleInterval === false) return false;
      const data = query.state.data;
      const inFlight = (data?.inFlight?.length ?? 0) > 0;
      if (inFlight) return activeInterval;
      return idleInterval ?? 60_000;
    },
    refetchOnWindowFocus: true,
    enabled: options?.enabled ?? true,
  });
}
