/**
 * Daily scheduled backup of every machine's agents to OSS.
 *
 * Pipeline
 * --------
 *   1. List ALL machines (regardless of ``status``). The status column is
 *      maintained by the health-check job, but several deployments either
 *      run with the gateway connector disabled or have machines that are
 *      reachable over SSH long before health-check flips them to
 *      ``online`` — filtering by status caused real bots to silently miss
 *      every backup window. SSH/OSS errors against an actually-offline
 *      machine still surface as per-agent failures (see step 3) and the
 *      rest of the queue keeps moving, so the cost of trying is bounded.
 *   2. For each machine, fetch every agent and drop drafts (provisioning
 *      placeholders with no remote workspace yet).
 *   3. Push each agent to OSS via ``DistillPushService.pushAgent`` with a
 *      bounded worker pool (default 2 concurrent). The service already
 *      diffs persona files by SHA so unchanged bots are a near-no-op;
 *      raw memory / skills / vector are re-uploaded each run, which is
 *      intentional (cheap, full-restore baseline).
 *   4. Per-agent timeouts prevent a stuck SSH session from holding the
 *      whole daily run open. The timed-out agent is marked failed but the
 *      rest of the queue keeps moving.
 *
 * Failure handling
 * ----------------
 * Per-agent errors are swallowed and tallied — the job NEVER throws out of
 * the worker, because BullMQ would otherwise mark the whole repeat as
 * failed and retry it (and we already snapshot what succeeded). The
 * structured summary log gives ops enough signal to chase stragglers.
 */
import type { Job } from 'bullmq';

import { config } from '../config/index.js';
import { createChildLogger } from '../shared/logger.js';
import type { AgentRepository } from '../modules/agents/agent.repository.js';
import type { MachineRepository } from '../modules/machines/machine.repository.js';
import type { DistillPushService } from '../modules/distill-push/distill-push.service.js';

const log = createChildLogger('daily-oss-backup-job');

interface Deps {
  machineRepo: MachineRepository;
  agentRepo: AgentRepository;
  distillPushService: DistillPushService;
}

export function createDailyOssBackupHandler(deps: Deps) {
  const { machineRepo, agentRepo, distillPushService } = deps;

  return async (_job: Job): Promise<void> => {
    const concurrency = config.dailyOssBackup.concurrency;
    const perAgentTimeoutMs = config.dailyOssBackup.perAgentTimeoutMs;

    log.info(
      { concurrency, perAgentTimeoutMs, cron: config.dailyOssBackup.cronPattern },
      'daily OSS backup starting',
    );
    const started = Date.now();

    // We intentionally do NOT filter by ``status: 'online'`` here. In
    // deployments where ``GATEWAY_CONNECTOR_ENABLED=false`` (e.g. the cloud
    // console that doesn't auto-pool SSH for live status), every machine
    // sits at ``status='offline'`` even though it is reachable. Filtering
    // would cause every daily run to no-op. Instead we attempt all
    // registered machines and let SSH/OSS errors surface per-agent.
    const candidateMachines = await machineRepo.findAll();
    if (candidateMachines.length === 0) {
      log.info('no machines registered — skipping daily OSS backup');
      return;
    }

    type Target = { machineId: string; machineAlias: string; agentDbId: string; agentId: string };
    const targets: Target[] = [];
    let skippedDraft = 0;
    let skippedDisabled = 0;
    for (const m of candidateMachines) {
      const agents = await agentRepo.findByMachineId(m.id);
      for (const a of agents) {
        if (a.status === 'draft') {
          skippedDraft += 1;
          continue;
        }
        // Per-bot opt-out. Manual ``push-to-oss/*`` routes deliberately
        // do NOT consult this flag — flipping it off only removes the
        // bot from the nightly cron, not from on-demand pushes.
        if (!a.ossSyncEnabled) {
          skippedDisabled += 1;
          log.debug(
            { machineAlias: m.alias ?? m.name, agentId: a.agentId },
            'daily backup: agent opted out (oss_sync_enabled=false)',
          );
          continue;
        }
        targets.push({
          machineId: m.id,
          machineAlias: m.alias ?? m.name,
          agentDbId: a.id,
          agentId: a.agentId,
        });
      }
    }

    if (targets.length === 0) {
      log.info(
        { machineCount: candidateMachines.length, skippedDraft, skippedDisabled },
        'no eligible agents — nothing to back up',
      );
      return;
    }

    log.info(
      {
        machineCount: candidateMachines.length,
        agentCount: targets.length,
        skippedDraft,
        skippedDisabled,
        machineStatuses: candidateMachines.map((m) => ({
          alias: m.alias ?? m.name,
          status: m.status,
        })),
      },
      'daily OSS backup: targets resolved',
    );

    let idx = 0;
    let okCount = 0;
    let failCount = 0;
    const failures: Array<{ machineAlias: string; agentId: string; error: string }> = [];

    const runOne = async (t: Target): Promise<void> => {
      // Wrap the push call in a timeout so a stuck SSH session doesn't
      // hold the whole daily run hostage. The push itself is mostly SSH
      // + OSS PUTs and finishes in a few seconds for unchanged bots,
      // so anything past 10min is almost certainly a hung connection.
      const start = Date.now();
      let timer: NodeJS.Timeout | undefined;
      try {
        const result = await Promise.race([
          distillPushService.pushAgent(t.machineId, t.agentDbId),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error(`per-agent timeout after ${perAgentTimeoutMs}ms`)),
              perAgentTimeoutMs,
            );
          }),
        ]);
        okCount += 1;
        log.info(
          {
            agentKey: result.agentKey,
            durationMs: result.durationMs,
            rawUploaded: result.rawUploaded,
            personaUploaded: result.personaUploaded,
            personaSkipped: result.personaSkipped,
            skillsUploaded: result.skillsUploaded,
          },
          'daily backup: agent ok',
        );
      } catch (err) {
        failCount += 1;
        const msg = (err as Error).message;
        failures.push({ machineAlias: t.machineAlias, agentId: t.agentId, error: msg });
        log.warn(
          {
            machineAlias: t.machineAlias,
            agentId: t.agentId,
            err: msg,
            durationMs: Date.now() - start,
          },
          'daily backup: agent failed',
        );
      } finally {
        if (timer) clearTimeout(timer);
      }
    };

    const workers = Array.from({ length: concurrency }, async () => {
      while (true) {
        const i = idx++;
        if (i >= targets.length) return;
        await runOne(targets[i]);
      }
    });
    await Promise.all(workers);

    log.info(
      {
        total: targets.length,
        ok: okCount,
        failed: failCount,
        skippedDraft,
        skippedDisabled,
        machineCount: candidateMachines.length,
        durationMs: Date.now() - started,
        failures: failures.slice(0, 20),
      },
      'daily OSS backup complete',
    );
  };
}
