import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { MachineService } from '../machines/machine.service.js';
import type { AgentRepository } from '../agents/agent.repository.js';
import type { FileRepository } from '../files/file.repository.js';
import type { SkillRepository } from '../skills/skill.repository.js';
import type { MonitoringRepository } from '../monitoring/monitoring.repository.js';
import type { SessionMonitorService } from '../monitoring/session-monitor.service.js';
import type { SyncEngine } from '../sync/sync-engine.js';
import { NotFoundError } from '../../shared/errors.js';
import { createChildLogger } from '../../shared/logger.js';
import type {
  BackupOptions,
  BackupProgressEvent,
  BackupResult,
  BackupStep,
} from './backup.types.js';

const log = createChildLogger('backup-service');

type ProgressEmitter = (event: BackupProgressEvent) => void;

const SESSION_PAGE_SIZE = 500;
const MESSAGE_PAGE_SIZE = 1000;
const DEFAULT_MAX_SESSIONS = 500;

/**
 * Orchestrates a full per-machine backup using ONLY existing services
 * (SyncEngine, SessionMonitorService, repositories). The backup is a
 * two-phase pipeline:
 *
 *   1. Refresh remote → DB:
 *      - executePull              → markdown / persona / memory / config / cron / hooks / skills
 *      - syncSessionsVia*         → session_snapshots
 *      - pullTranscriptVia* (×N)  → session_messages for every snapshot
 *
 *   2. Export DB → on-disk backup directory:
 *      - openclaw-home/<relativePath>      mirrors ~/.openclaw structure
 *      - agents/<agentId>/sessions.json    snapshot index per agent
 *      - agents/<agentId>/sessions/<key>.json   one file per session w/ messages
 *      - skills-catalog/<skillKey>/        full SKILL.md + auxiliary files
 *      - manifest.json                      machine metadata, agents, counts, durations
 *
 * Each step emits a progress event so the SSE route can stream feedback.
 * One failed transcript or file does not abort the run; failures are
 * accumulated in the manifest's `errors` field.
 */
export class BackupService {
  constructor(
    private machineService: MachineService,
    private agentRepo: AgentRepository,
    private fileRepo: FileRepository,
    private skillRepo: SkillRepository,
    private monitoringRepo: MonitoringRepository,
    private syncEngine: SyncEngine,
    private sessionMonitor: SessionMonitorService,
    /** Absolute path to the directory under which per-machine backups land. */
    private backupRoot: string,
  ) {}

  async backupMachine(
    machineId: string,
    emit: ProgressEmitter,
    options: BackupOptions = {},
  ): Promise<BackupResult> {
    const start = Date.now();
    const machine = await this.machineService.getMachine(machineId);
    if (!machine) throw new NotFoundError('Machine', machineId);

    const connInfo = this.machineService.toConnectionInfo(machine);
    const maxSessions = Math.max(1, options.maxSessions ?? DEFAULT_MAX_SESSIONS);

    // ─── Output directory ────────────────────────────────────────────
    // Layout: <backupRoot>/<safeMachineName>/<ISO-timestamp>/
    // Sanitize the machine name so it survives any filesystem.
    const safeName = machine.name.replace(/[^a-zA-Z0-9._-]/g, '-');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const outputDir = path.join(this.backupRoot, safeName, stamp);
    await fs.mkdir(outputDir, { recursive: true });

    emit({
      step: 'init',
      status: 'success',
      message: `Backup target: ${outputDir}`,
      detail: { outputDir, machineName: machine.name, machineId: machine.id },
    });

    const errors: Array<{ step: BackupStep; ref: string; message: string }> = [];

    // ─── Phase 1: Refresh remote → DB ────────────────────────────────
    if (!options.skipRefresh) {
      // 1a. Pull file manifest into managed_files. This covers persona,
      //     memory markdown, config, cron, hooks, agent/global skills.
      emit({ step: 'pull-files', status: 'running', message: 'Pulling files from remote...' });
      try {
        const pull = await this.syncEngine.executePull(
          machineId,
          connInfo,
          machine.openclawHome,
          'backup',
        );
        emit({
          step: 'pull-files',
          status: 'success',
          message: `Pulled ${pull.syncedFiles} files (${pull.failedFiles} failed)`,
          detail: { synced: pull.syncedFiles, failed: pull.failedFiles, durationMs: pull.durationMs },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push({ step: 'pull-files', ref: machine.id, message: msg });
        emit({ step: 'pull-files', status: 'error', message: `Pull failed: ${msg}` });
      }

      // 1b. Refresh skills + workspace discovery so newly added skills
      //     get their SKILL.md content into the catalog before export.
      try {
        await this.machineService.discoverStructure(machineId);
      } catch (err) {
        log.warn({ machineId, err: (err as Error).message }, 'Skills discovery failed during backup');
      }

      // 1c. Refresh session snapshots (gateway first, SSH fallback).
      emit({ step: 'pull-sessions', status: 'running', message: 'Pulling session snapshots...' });
      try {
        let synced = await this.sessionMonitor.syncSessionsViaGateway(machineId);
        if (synced === 0) {
          synced = await this.sessionMonitor.syncSessionsViaSSH(
            machineId,
            connInfo,
            machine.openclawHome,
          );
        }
        emit({
          step: 'pull-sessions',
          status: 'success',
          message: `Synced ${synced} session snapshots`,
          detail: { synced },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push({ step: 'pull-sessions', ref: machine.id, message: msg });
        emit({ step: 'pull-sessions', status: 'error', message: `Snapshot sync failed: ${msg}` });
      }
    } else {
      emit({
        step: 'pull-files',
        status: 'success',
        message: 'Skipped (skipRefresh=true); using DB cache',
      });
      emit({
        step: 'pull-sessions',
        status: 'success',
        message: 'Skipped (skipRefresh=true); using DB cache',
      });
    }

    // 1d. Pull transcripts for every snapshot (gateway first, SSH fallback).
    //     We re-pull every session even if some messages exist locally:
    //     pullTranscriptVia* is idempotent (uses messageIndex unique
    //     constraint) and only inserts NEW messages thanks to
    //     getMaxMessageIndex, so the cost is bounded.
    const snapshots = await this.fetchAllSnapshots(machineId, maxSessions);
    if (!options.skipRefresh) {
      emit({
        step: 'pull-transcripts',
        status: 'running',
        message: `Pulling transcripts for ${snapshots.length} sessions...`,
        total: snapshots.length,
      });

      let pulledTotal = 0;
      let transcriptFailures = 0;
      for (let i = 0; i < snapshots.length; i++) {
        const snap = snapshots[i];
        const sessionId = snap.sessionId ?? snap.sessionKey;
        try {
          let pulled = await this.sessionMonitor.pullTranscriptViaGateway(
            machineId,
            snap.sessionKey,
            snap.agentId,
          );
          if (pulled === 0) {
            pulled = await this.sessionMonitor.pullTranscriptViaSSH(
              machineId,
              connInfo,
              machine.openclawHome,
              snap.agentId,
              sessionId,
            );
          }
          pulledTotal += pulled;
        } catch (err) {
          transcriptFailures++;
          const msg = err instanceof Error ? err.message : String(err);
          errors.push({ step: 'pull-transcripts', ref: snap.sessionKey, message: msg });
          log.warn(
            { machineId, sessionKey: snap.sessionKey, err: msg },
            'transcript pull failed during backup',
          );
        }

        if ((i + 1) % 5 === 0 || i === snapshots.length - 1) {
          emit({
            step: 'pull-transcripts',
            status: 'running',
            message: `Pulled ${i + 1}/${snapshots.length} sessions (${pulledTotal} new messages)`,
            current: i + 1,
            total: snapshots.length,
          });
        }
      }
      emit({
        step: 'pull-transcripts',
        status: 'success',
        message: `Done: ${pulledTotal} new messages across ${snapshots.length} sessions (${transcriptFailures} failures)`,
        detail: { newMessages: pulledTotal, failures: transcriptFailures },
      });
    }

    // ─── Phase 2: Export DB → disk ───────────────────────────────────

    // 2a. Files: walk managed_files, write each to <outputDir>/openclaw-home/<relPath>.
    //     We use this.fileRepo.listFiles to get metadata and re-fetch content
    //     per-file via findById (because listFiles doesn't include content).
    //     Listing is small enough (text-only files in MySQL).
    const homeDir = path.join(outputDir, 'openclaw-home');
    await fs.mkdir(homeDir, { recursive: true });
    emit({ step: 'export-files', status: 'running', message: 'Writing files to disk...' });

    const allFiles = await this.fileRepo.listFiles(machineId);
    let filesWritten = 0;
    let filesSkipped = 0;
    for (const meta of allFiles) {
      const file = await this.fileRepo.findById(meta.id);
      if (!file?.content) {
        filesSkipped++;
        continue;
      }
      const target = this.safeJoin(homeDir, file.relativePath);
      if (!target) {
        filesSkipped++;
        log.warn({ relativePath: file.relativePath }, 'rejected unsafe relative path');
        continue;
      }
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, file.content, 'utf8');
      filesWritten++;
    }
    emit({
      step: 'export-files',
      status: 'success',
      message: `Wrote ${filesWritten} files (${filesSkipped} skipped)`,
      detail: { written: filesWritten, skipped: filesSkipped },
    });

    // 2b. Sessions: per-agent index + per-session JSON with full transcript.
    //     We re-read snapshots from DB to pick up anything refreshed above.
    emit({ step: 'export-sessions', status: 'running', message: 'Writing sessions and transcripts...' });
    const finalSnapshots = await this.fetchAllSnapshots(machineId, maxSessions);
    const agents = await this.agentRepo.findByMachineId(machineId);
    const agentsDir = path.join(outputDir, 'agents');
    await fs.mkdir(agentsDir, { recursive: true });

    let sessionFilesWritten = 0;
    let messagesWritten = 0;

    // Group snapshots by agentId. Sessions whose agentId doesn't match
    // any persisted Agent (legacy data, manual cron) still get exported
    // under their literal agentId so nothing is silently dropped.
    const byAgent = new Map<string, typeof finalSnapshots>();
    for (const snap of finalSnapshots) {
      const list = byAgent.get(snap.agentId) ?? [];
      list.push(snap);
      byAgent.set(snap.agentId, list);
    }

    const agentMetaByAgentId = new Map(agents.map((a) => [a.agentId, a]));
    for (const [agentIdStr, snaps] of byAgent.entries()) {
      const agentDir = path.join(agentsDir, this.sanitizeFilename(agentIdStr));
      const sessionsDir = path.join(agentDir, 'sessions');
      await fs.mkdir(sessionsDir, { recursive: true });

      // Write the agent metadata (if known).
      const agentMeta = agentMetaByAgentId.get(agentIdStr);
      if (agentMeta) {
        await fs.writeFile(
          path.join(agentDir, 'agent.json'),
          JSON.stringify(agentMeta, null, 2),
          'utf8',
        );
      }

      // Snapshot index for this agent.
      await fs.writeFile(
        path.join(agentDir, 'sessions.json'),
        JSON.stringify(snaps, null, 2),
        'utf8',
      );

      for (const snap of snaps) {
        const sessionId = snap.sessionId ?? snap.sessionKey;
        const messages = await this.fetchAllMessages(machineId, sessionId);
        const fname = `${this.sanitizeFilename(snap.sessionKey)}.json`;
        await fs.writeFile(
          path.join(sessionsDir, fname),
          JSON.stringify({ snapshot: snap, messages }, null, 2),
          'utf8',
        );
        sessionFilesWritten++;
        messagesWritten += messages.length;
      }
    }
    emit({
      step: 'export-sessions',
      status: 'success',
      message: `Wrote ${sessionFilesWritten} session files (${messagesWritten} total messages) across ${byAgent.size} agents`,
      detail: { sessionFiles: sessionFilesWritten, messages: messagesWritten, agents: byAgent.size },
    });

    // 2c. Skills catalog: dump every discovered skill (machine-global + per-agent)
    //     with its FULL skill_md_content + auxiliary files. This is the same
    //     data the distill-bundle endpoint exports — repackaged on disk so the
    //     backup is self-contained even if the catalog gets pruned later.
    emit({ step: 'export-skills', status: 'running', message: 'Writing skills catalog...' });
    const skillKeys = new Set<string>();
    for (const k of machine.discoveredSkills ?? []) skillKeys.add(k);
    for (const a of agents) {
      for (const k of a.discoveredSkills ?? []) skillKeys.add(k);
    }
    const skillsDir = path.join(outputDir, 'skills-catalog');
    await fs.mkdir(skillsDir, { recursive: true });

    let skillsWritten = 0;
    for (const skillKey of skillKeys) {
      const skill = await this.skillRepo.findByKey(skillKey);
      if (!skill) continue;
      const skillDir = path.join(skillsDir, this.sanitizeFilename(skillKey));
      await fs.mkdir(skillDir, { recursive: true });

      if (skill.skillMdContent) {
        await fs.writeFile(path.join(skillDir, 'SKILL.md'), skill.skillMdContent, 'utf8');
      }
      if (skill.auxiliaryFiles) {
        for (const [name, content] of Object.entries(skill.auxiliaryFiles)) {
          const auxTarget = this.safeJoin(skillDir, name);
          if (!auxTarget) {
            log.warn({ skillKey, auxName: name }, 'rejected unsafe aux file path');
            continue;
          }
          await fs.mkdir(path.dirname(auxTarget), { recursive: true });
          await fs.writeFile(auxTarget, content, 'utf8');
        }
      }

      await fs.writeFile(
        path.join(skillDir, '_meta.json'),
        JSON.stringify(
          {
            skillKey: skill.skillKey,
            name: skill.name,
            description: skill.description,
            scope: skill.scope,
            source: skill.source,
            version: skill.version,
            requiresBins: skill.requiresBins,
            requiresEnv: skill.requiresEnv,
            tags: skill.tags,
          },
          null,
          2,
        ),
        'utf8',
      );
      skillsWritten++;
    }
    emit({
      step: 'export-skills',
      status: 'success',
      message: `Wrote ${skillsWritten} skills`,
      detail: { skills: skillsWritten },
    });

    // 2d. Manifest: top-level summary so the backup is self-describing.
    emit({ step: 'manifest', status: 'running', message: 'Writing manifest...' });
    const durationMs = Date.now() - start;
    const manifest = {
      version: 1,
      generatedAt: new Date().toISOString(),
      durationMs,
      machine: {
        id: machine.id,
        name: machine.name,
        tailscaleHostname: machine.tailscaleHostname,
        sshUser: machine.sshUser,
        sshPort: machine.sshPort,
        openclawHome: machine.openclawHome,
        openclawVersion: machine.openclawVersion,
        modelConfig: machine.modelConfig,
        discoveredSkills: machine.discoveredSkills ?? [],
        tags: machine.tags ?? [],
        status: machine.status,
        lastHealthCheckAt: machine.lastHealthCheckAt?.toISOString() ?? null,
      },
      agents: agents.map((a) => ({
        id: a.id,
        agentId: a.agentId,
        name: a.name,
        description: a.description,
        isDefault: a.isDefault,
        workspacePath: a.workspacePath,
        modelConfig: a.modelConfig,
        discoveredSkills: a.discoveredSkills ?? [],
        status: a.status,
        lastSyncedAt: a.lastSyncedAt?.toISOString() ?? null,
      })),
      counts: {
        files: filesWritten,
        sessions: sessionFilesWritten,
        messages: messagesWritten,
        skills: skillsWritten,
        snapshots: finalSnapshots.length,
      },
      options: {
        maxSessions,
        skipRefresh: Boolean(options.skipRefresh),
      },
      errors,
    };
    await fs.writeFile(
      path.join(outputDir, 'manifest.json'),
      JSON.stringify(manifest, null, 2),
      'utf8',
    );
    emit({ step: 'manifest', status: 'success', message: 'Manifest written' });

    const result: BackupResult = {
      outputDir,
      machineId: machine.id,
      machineName: machine.name,
      totalFiles: filesWritten,
      totalSessions: sessionFilesWritten,
      totalMessages: messagesWritten,
      totalSkills: skillsWritten,
      durationMs,
    };

    emit({
      step: 'done',
      status: 'success',
      message: `Backup complete: ${outputDir}`,
      detail: result as unknown as Record<string, unknown>,
    });

    log.info(
      { ...result, errorCount: errors.length },
      'Backup completed',
    );

    return result;
  }

  // ─── Helpers ───────────────────────────────────────────────────────

  /** Page through monitoring snapshots up to a hard cap. */
  private async fetchAllSnapshots(machineId: string, maxSessions: number) {
    const all = [];
    let offset = 0;
    while (all.length < maxSessions) {
      const page = await this.monitoringRepo.findSessionSnapshots({
        machineId,
        limit: Math.min(SESSION_PAGE_SIZE, maxSessions - all.length),
        offset,
      });
      if (page.length === 0) break;
      all.push(...page);
      if (page.length < SESSION_PAGE_SIZE) break;
      offset += page.length;
    }
    return all;
  }

  /** Page through every message of a session. */
  private async fetchAllMessages(machineId: string, sessionId: string) {
    const all = [];
    let offset = 0;
    // Hard upper bound to avoid runaway memory if a session is corrupt.
    const HARD_CAP = 50_000;
    while (all.length < HARD_CAP) {
      const page = await this.monitoringRepo.findSessionMessages({
        machineId,
        sessionId,
        limit: MESSAGE_PAGE_SIZE,
        offset,
      });
      if (page.length === 0) break;
      all.push(...page);
      if (page.length < MESSAGE_PAGE_SIZE) break;
      offset += page.length;
    }
    return all;
  }

  /** Replace characters that are unsafe in filenames across platforms. */
  private sanitizeFilename(name: string): string {
    return name.replace(/[/\\?%*:|"<>\0]/g, '_');
  }

  /**
   * Resolve `relPath` under `baseDir` and return null if the result
   * escapes the base directory (e.g. `..` traversal in DB content).
   */
  private safeJoin(baseDir: string, relPath: string): string | null {
    const cleaned = relPath.replace(/^\.\//, '');
    const target = path.resolve(baseDir, cleaned);
    const rel = path.relative(baseDir, target);
    if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
    return target;
  }
}
