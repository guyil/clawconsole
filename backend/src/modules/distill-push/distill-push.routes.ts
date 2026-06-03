/**
 * HTTP routes exposing the OSS-direct distill push orchestrator.
 *
 * All POST endpoints are async: they enqueue jobs onto the
 * ``manual-oss-distill`` BullMQ queue and return 202 immediately. A single
 * push can take 5+ min on a cold mac-mini (heavy ``openclaw memory index``
 * step), which used to time out at nginx's 300s proxy_read_timeout and
 * surface as a 504 to the user. Now the UI polls ``/status`` to observe
 * each agent row flipping ``last_oss_sync_at`` / ``last_oss_sync_status``.
 *
 *   POST /api/distill/push-to-oss/single
 *     body: { machineId, agentId }
 *     → enqueues 1 job; returns { ok, enqueued: 1, jobIds: [...] }
 *
 *   POST /api/distill/push-to-oss/machine
 *     body: { machineId, agentIds?: string[] }
 *     → enqueues 1 job per agent on the machine; returns the same shape
 *
 *   POST /api/distill/push-to-oss/all
 *     body: { onlineOnly?: boolean (default true),
 *             includeDrafts?: boolean (default false) }
 *     → enqueues 1 job per (machine × non-draft agent); concurrency is
 *       governed by the worker (DAILY_OSS_BACKUP_CONCURRENCY) so the legacy
 *       ``concurrency`` field is accepted but ignored.
 *
 *   GET /api/distill/push-to-oss/status
 *     query: { recentRuns?: number (default 5, max 50) }
 *     → returns a snapshot for the UI dashboard:
 *         {
 *           cron: { enabled, pattern, timezone, nextRunAt },
 *           recentRuns: [{ id, completedAt, finishedAt, status, durationMs }],
 *           inFlight: [{ jobId, agentDbId, agentId, agentName,
 *                        machineId, machineAlias, machineName,
 *                        state: 'waiting'|'active', enqueuedAt }],
 *           machines: [{ machineId, machineAlias, machineName,
 *                        machineStatus, agentCount, distillableAgentCount }],
 *           agents: [{ machineAlias, agentId, lastOssSyncAt,
 *                      lastOssSyncStatus, lastOssSyncError,
 *                      lastOssVectorSha, lastOssDurationMs, … }],
 *           summary: { total, ok, failed, neverSynced, inFlight, oldestSyncAt }
 *         }
 *       Read-only and cheap (one DB list + a handful of Redis ZRANGEs);
 *       safe to poll from the BotsPage every 5–60s.
 *
 *  Requires:
 *   - ALIYUN_OSS_* env vars (otherwise the worker throws)
 *   - MINICLAW_BASE_URL + MINICLAW_DISTILL_SERVICE_TOKEN env vars
 *     (otherwise the webhook step is a no-op warning)
 */
import type { FastifyInstance } from 'fastify';
import type { Queue } from 'bullmq';
import { z } from 'zod';

import { DistillPushService } from './distill-push.service.js';
import type { MachineRepository } from '../machines/machine.repository.js';
import type { AgentRepository } from '../agents/agent.repository.js';
import type { ManualOssDistillJobData } from '../../jobs/manual-oss-distill.job.js';
import { config } from '../../config/index.js';
import { createChildLogger } from '../../shared/logger.js';

const log = createChildLogger('distill-push-routes');

interface Deps {
  distillPushService: DistillPushService;
  machineRepo: MachineRepository;
  agentRepo: AgentRepository;
  /**
   * BullMQ queue handle for the daily-oss-backup job. Optional so unit
   * tests can register the routes without a Redis connection; when
   * absent, the status endpoint returns an empty ``recentRuns`` array
   * and ``cron.nextRunAt`` will be null.
   */
  dailyOssBackupQueue?: Queue;
  /**
   * Manual / on-demand distill queue. POST routes enqueue here and return
   * 202 immediately so the request doesn't sit blocked through the 5+min
   * pipeline. Optional for the same test-friendliness reason as above —
   * when absent, the routes 503 instead of running the legacy inline path.
   */
  manualOssDistillQueue?: Queue<ManualOssDistillJobData>;
}

const SinglePushSchema = z.object({
  machineId: z.string().min(1),
  agentId: z.string().min(1),
});

const MachinePushSchema = z.object({
  machineId: z.string().min(1),
  agentIds: z.array(z.string().min(1)).optional(),
});

const AllPushSchema = z.object({
  onlineOnly: z.boolean().optional(),
  includeDrafts: z.boolean().optional(),
  // Concurrency is now governed by the manual-oss-distill worker
  // (DAILY_OSS_BACKUP_CONCURRENCY env). Field kept for backwards
  // compatibility; ignored if present.
  concurrency: z.number().int().min(1).max(8).optional(),
});

/**
 * Enqueue one distill job and return its handle. The worker will call
 * ``DistillPushService.pushAgent`` and stamp the agent row with
 * success/failure state. Default options skip retries (a manual click is
 * the natural retry path) and trim history aggressively (we only need
 * a few recent runs for the dashboard's "current activity" view).
 */
async function enqueueDistill(
  queue: Queue<ManualOssDistillJobData>,
  data: ManualOssDistillJobData,
): Promise<{ jobId: string | null }> {
  const job = await queue.add('push-agent', data, {
    attempts: 1,
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 50 },
  });
  return { jobId: job.id ?? null };
}

export async function registerDistillPushRoutes(
  fastify: FastifyInstance,
  deps: Deps,
): Promise<void> {
  fastify.post('/api/distill/push-to-oss/single', async (request, reply) => {
    const body = SinglePushSchema.safeParse(request.body);
    if (!body.success) {
      reply.code(400);
      return { error: 'Invalid body', issues: body.error.flatten() };
    }
    if (!deps.manualOssDistillQueue) {
      reply.code(503);
      return { error: 'manual distill queue not wired up' };
    }
    // We resolve the agent here (rather than in the worker) so that
    // bad input fails fast with 4xx instead of silently rotting in
    // the queue. The actual push happens asynchronously below.
    const agent = await deps.agentRepo.findById(body.data.agentId);
    if (!agent || agent.machineId !== body.data.machineId) {
      reply.code(404);
      return { error: 'agent not found on machine' };
    }
    const handle = await enqueueDistill(deps.manualOssDistillQueue, {
      machineId: body.data.machineId,
      agentDbId: body.data.agentId,
      source: 'single',
    });
    log.info(
      { jobId: handle.jobId, machineId: body.data.machineId, agentDbId: body.data.agentId },
      'manual distill enqueued (single)',
    );
    reply.code(202);
    return { ok: true, enqueued: 1, jobIds: [handle.jobId].filter(Boolean) };
  });

  fastify.post('/api/distill/push-to-oss/machine', async (request, reply) => {
    const body = MachinePushSchema.safeParse(request.body);
    if (!body.success) {
      reply.code(400);
      return { error: 'Invalid body', issues: body.error.flatten() };
    }
    if (!deps.manualOssDistillQueue) {
      reply.code(503);
      return { error: 'manual distill queue not wired up' };
    }

    const machine = await deps.machineRepo.findById(body.data.machineId);
    if (!machine) {
      reply.code(404);
      return { error: 'machine not found' };
    }

    let targets: { id: string; agentId: string }[] = [];
    if (body.data.agentIds?.length) {
      for (const id of body.data.agentIds) {
        const a = await deps.agentRepo.findById(id);
        if (a && a.machineId === machine.id) {
          targets.push({ id: a.id, agentId: a.agentId });
        }
      }
    } else {
      const all = await deps.agentRepo.findByMachineId(machine.id);
      targets = all
        .filter((a) => a.status !== 'draft')
        .map((a) => ({ id: a.id, agentId: a.agentId }));
    }

    const jobIds: string[] = [];
    for (const t of targets) {
      const handle = await enqueueDistill(deps.manualOssDistillQueue, {
        machineId: machine.id,
        agentDbId: t.id,
        source: 'machine',
      });
      if (handle.jobId) jobIds.push(handle.jobId);
    }
    log.info(
      { machineId: machine.id, enqueued: jobIds.length },
      'manual distill enqueued (machine)',
    );
    reply.code(202);
    return { ok: true, machineId: machine.id, enqueued: jobIds.length, jobIds };
  });

  fastify.post('/api/distill/push-to-oss/all', async (request, reply) => {
    const parsed = AllPushSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      reply.code(400);
      return { error: 'Invalid body', issues: parsed.error.flatten() };
    }
    if (!deps.manualOssDistillQueue) {
      reply.code(503);
      return { error: 'manual distill queue not wired up' };
    }
    const onlineOnly = parsed.data.onlineOnly ?? true;
    const includeDrafts = parsed.data.includeDrafts ?? false;

    const machines = await deps.machineRepo.findAll(
      onlineOnly ? { status: 'online' } : undefined,
    );
    const jobIds: string[] = [];
    for (const m of machines) {
      const agents = await deps.agentRepo.findByMachineId(m.id);
      for (const a of agents) {
        if (!includeDrafts && a.status === 'draft') continue;
        const handle = await enqueueDistill(deps.manualOssDistillQueue, {
          machineId: m.id,
          agentDbId: a.id,
          source: 'all',
        });
        if (handle.jobId) jobIds.push(handle.jobId);
      }
    }
    log.info(
      { machineCount: machines.length, enqueued: jobIds.length, onlineOnly, includeDrafts },
      'manual distill enqueued (all)',
    );
    reply.code(202);
    return { ok: true, enqueued: jobIds.length, jobIds };
  });

  // -------------------------------------------------------------------
  // GET /api/distill/push-to-oss/status — read-only dashboard snapshot
  // -------------------------------------------------------------------
  //
  // The BotsPage polls this every minute. It must stay cheap:
  //   - 1x ``agents.findAll()`` (already paginated under the hood; the
  //     payload is small — one row per agent).
  //   - 1x ``machines.findAll()`` (so we can resolve ``machineAlias``
  //     for grouping; ``findAll`` joins agent_count but no ad-hoc
  //     subqueries beyond that).
  //   - <= 3 BullMQ ZRANGE calls (repeat schedulers + completed +
  //     failed). Each is O(N) on a small bounded set (we configure
  //     ``removeOnComplete: 50`` / ``removeOnFail: 20``).
  //
  // We deliberately do NOT hit OSS here — the agent row is the source
  // of truth for "did the most recent push succeed" because the
  // service stamps it after each attempt. The mini-claw side has its
  // own freshness API if a cross-system audit is needed.
  fastify.get('/api/distill/push-to-oss/status', async (request) => {
    const StatusQuery = z.object({
      recentRuns: z.coerce.number().int().min(1).max(50).optional(),
    });
    const parsed = StatusQuery.safeParse(request.query ?? {});
    const recentRunsLimit = parsed.success ? parsed.data.recentRuns ?? 5 : 5;

    const cronCfg = {
      enabled: config.jobs.dailyOssBackupEnabled,
      pattern: config.dailyOssBackup.cronPattern,
      timezone: config.dailyOssBackup.timezone,
      concurrency: config.dailyOssBackup.concurrency,
      perAgentTimeoutMs: config.dailyOssBackup.perAgentTimeoutMs,
    };

    // --- Cron schedule + recent runs from BullMQ -------------------
    let nextRunAt: string | null = null;
    type RunInfo = {
      id: string | null;
      name: string | null;
      timestamp: string | null;
      finishedAt: string | null;
      status: 'completed' | 'failed';
      durationMs: number | null;
      failedReason?: string | null;
      attemptsMade?: number;
    };
    const recentRuns: RunInfo[] = [];

    if (deps.dailyOssBackupQueue) {
      try {
        const schedulers = await deps.dailyOssBackupQueue.getJobSchedulers();
        // BullMQ stores `next` as ms-epoch on the scheduler row; pick the
        // earliest ``next`` across all schedulers (we only register one
        // for this queue, but be robust to manual additions).
        let earliest: number | null = null;
        for (const s of schedulers) {
          const next = (s as { next?: number | null }).next ?? null;
          if (typeof next === 'number' && (earliest === null || next < earliest)) {
            earliest = next;
          }
        }
        if (earliest !== null) {
          nextRunAt = new Date(earliest).toISOString();
        }
      } catch (err) {
        log.warn(
          { err: (err as Error).message },
          'getJobSchedulers failed; nextRunAt unavailable',
        );
      }

      try {
        const completed = await deps.dailyOssBackupQueue.getJobs(
          ['completed'],
          0,
          recentRunsLimit - 1,
          false,
        );
        const failed = await deps.dailyOssBackupQueue.getJobs(
          ['failed'],
          0,
          recentRunsLimit - 1,
          false,
        );
        const merged = [
          ...completed.map((j) => ({ job: j, status: 'completed' as const })),
          ...failed.map((j) => ({ job: j, status: 'failed' as const })),
        ];
        merged.sort(
          (a, b) =>
            (b.job.finishedOn ?? b.job.timestamp ?? 0) -
            (a.job.finishedOn ?? a.job.timestamp ?? 0),
        );
        for (const { job, status } of merged.slice(0, recentRunsLimit)) {
          const startedMs = job.processedOn ?? job.timestamp ?? null;
          const finishedMs = job.finishedOn ?? null;
          recentRuns.push({
            id: job.id ?? null,
            name: job.name ?? null,
            timestamp: job.timestamp ? new Date(job.timestamp).toISOString() : null,
            finishedAt: finishedMs ? new Date(finishedMs).toISOString() : null,
            status,
            durationMs:
              startedMs !== null && finishedMs !== null ? finishedMs - startedMs : null,
            failedReason: job.failedReason ?? null,
            attemptsMade: job.attemptsMade,
          });
        }
      } catch (err) {
        log.warn(
          { err: (err as Error).message },
          'getJobs(completed/failed) failed; recentRuns will be empty',
        );
      }
    }

    // --- Per-agent snapshot ----------------------------------------
    const machines = await deps.machineRepo.findAll();
    const aliasById = new Map<string, string>();
    const machineById = new Map(machines.map((m) => [m.id, m]));
    for (const m of machines) {
      aliasById.set(m.id, m.alias ?? m.name);
    }

    const agents = await deps.agentRepo.findAll();
    const agentRows = agents
      .filter((a) => a.status !== 'draft') // drafts have no remote workspace yet
      .map((a) => ({
        agentDbId: a.id,
        agentId: a.agentId,
        name: a.name,
        machineId: a.machineId,
        machineAlias: aliasById.get(a.machineId) ?? a.machineName,
        machineName: a.machineName,
        machineStatus: a.machineStatus,
        status: a.status,
        // Per-bot opt-in for the nightly cron. UI uses this both to
        // render the row's toggle and to mark opted-out bots so users
        // don't mistake "no recent sync" for a failure.
        ossSyncEnabled: a.ossSyncEnabled,
        lastOssSyncAt: a.lastOssSyncAt ? a.lastOssSyncAt.toISOString() : null,
        lastOssSyncStatus: a.lastOssSyncStatus,
        lastOssSyncError: a.lastOssSyncError,
        lastOssVectorSha: a.lastOssVectorSha,
        lastOssDurationMs: a.lastOssDurationMs,
      }));

    const distillableAgentCountByMachine = new Map<string, number>();
    for (const r of agentRows) {
      distillableAgentCountByMachine.set(
        r.machineId,
        (distillableAgentCountByMachine.get(r.machineId) ?? 0) + 1,
      );
    }
    const machineRows = machines.map((m) => ({
      machineId: m.id,
      machineAlias: m.alias ?? m.name,
      machineName: m.name,
      machineStatus: m.status,
      agentCount: m.agentCount,
      distillableAgentCount: distillableAgentCountByMachine.get(m.id) ?? 0,
    }));

    // --- In-flight manual distill jobs -----------------------------
    type InFlight = {
      jobId: string;
      agentDbId: string;
      agentId: string | null;
      agentName: string | null;
      machineId: string | null;
      machineAlias: string | null;
      machineName: string | null;
      state: 'waiting' | 'active';
      enqueuedAt: string | null;
      startedAt: string | null;
      source: string | null;
    };
    const inFlight: InFlight[] = [];
    if (deps.manualOssDistillQueue) {
      try {
        // ``waiting``: queued, not yet picked. ``active``: a worker is
        // currently running it. Together they're the set of agents the
        // UI should mark as "正在蒸馏..." right now.
        const [waiting, active] = await Promise.all([
          deps.manualOssDistillQueue.getJobs(['waiting'], 0, 199, false),
          deps.manualOssDistillQueue.getJobs(['active'], 0, 49, false),
        ]);
        const agentById = new Map(agents.map((a) => [a.id, a]));
        for (const job of [...waiting, ...active]) {
          if (!job.id) continue;
          const data = job.data as ManualOssDistillJobData | undefined;
          if (!data?.agentDbId) continue;
          const a = agentById.get(data.agentDbId);
          const machineId = a?.machineId ?? data.machineId ?? null;
          const machine = machineId ? machineById.get(machineId) : undefined;
          inFlight.push({
            jobId: job.id,
            agentDbId: data.agentDbId,
            agentId: a?.agentId ?? null,
            agentName: a?.name ?? null,
            machineId,
            machineAlias:
              machineId !== null
                ? aliasById.get(machineId) ?? machine?.name ?? null
                : null,
            machineName: machine?.name ?? a?.machineName ?? null,
            state: job.processedOn ? 'active' : 'waiting',
            enqueuedAt: job.timestamp ? new Date(job.timestamp).toISOString() : null,
            startedAt: job.processedOn ? new Date(job.processedOn).toISOString() : null,
            source: data.source ?? null,
          });
        }
      } catch (err) {
        log.warn(
          { err: (err as Error).message },
          'getJobs(waiting/active) failed; inFlight will be empty',
        );
      }
    }

    // --- Summary counters ------------------------------------------
    let okCount = 0;
    let failedCount = 0;
    let neverSyncedCount = 0;
    let disabledCount = 0;
    let oldestSyncMs: number | null = null;
    for (const r of agentRows) {
      if (!r.ossSyncEnabled) disabledCount += 1;
      if (!r.lastOssSyncAt) {
        // Only count an opted-in bot as "never synced" — opted-out bots
        // legitimately have no sync history, so flagging them yellow
        // would create false alarms in the dashboard.
        if (r.ossSyncEnabled) neverSyncedCount += 1;
        continue;
      }
      if (r.lastOssSyncStatus === 'ok') okCount += 1;
      else if (r.lastOssSyncStatus === 'failed') failedCount += 1;
      // ``oldestSyncAt`` should track stragglers in the active fleet;
      // including opted-out bots' frozen timestamps would make the
      // dashboard's "最旧 X 天前" misleading.
      if (!r.ossSyncEnabled) continue;
      const ms = Date.parse(r.lastOssSyncAt);
      if (!Number.isNaN(ms) && (oldestSyncMs === null || ms < oldestSyncMs)) {
        oldestSyncMs = ms;
      }
    }

    return {
      cron: {
        ...cronCfg,
        nextRunAt,
      },
      recentRuns,
      inFlight,
      summary: {
        total: agentRows.length,
        ok: okCount,
        failed: failedCount,
        neverSynced: neverSyncedCount,
        disabled: disabledCount,
        inFlight: inFlight.length,
        oldestSyncAt: oldestSyncMs !== null ? new Date(oldestSyncMs).toISOString() : null,
      },
      machines: machineRows,
      agents: agentRows,
    };
  });
}
