import type { MonitoringRepository } from './monitoring.repository.js';
import type { SessionMonitorService } from './session-monitor.service.js';
import type { LogCollectorService } from './log-collector.service.js';
import type { GatewayConnectorPool } from './gateway-connector.js';
import type { MachineService } from '../machines/machine.service.js';
import type {
  SessionSnapshotFilters,
  SessionMessageFilters,
  GatewayLogFilters,
  DiagnosticEventFilters,
  MonitoringDashboard,
} from './monitoring.types.js';
import { config } from '../../config/index.js';
import { createChildLogger } from '../../shared/logger.js';

const log = createChildLogger('monitoring-service');

export class MonitoringService {
  constructor(
    private repo: MonitoringRepository,
    private sessionMonitor: SessionMonitorService,
    private logCollector: LogCollectorService,
    _gatewayPool: GatewayConnectorPool,
    private machineService: MachineService,
  ) {}

  // ─── Session Queries ─────────────────────────────────────────────

  async listSessions(filters: SessionSnapshotFilters) {
    const [sessions, total] = await Promise.all([
      this.repo.findSessionSnapshots(filters),
      this.repo.countSessionSnapshots({
        machineId: filters.machineId,
        agentId: filters.agentId,
        activeMinutes: filters.activeMinutes,
      }),
    ]);
    return { data: sessions, total };
  }

  async getSessionTranscript(filters: SessionMessageFilters) {
    const [messages, total] = await Promise.all([
      this.repo.findSessionMessages(filters),
      this.repo.countSessionMessages(filters.machineId, filters.sessionId),
    ]);
    return { data: messages, total };
  }

  async getSessionByKey(machineId: string, sessionKey: string) {
    return this.repo.findSessionSnapshotByKey(machineId, sessionKey);
  }

  // ─── Log Queries ─────────────────────────────────────────────────

  async listLogs(filters: GatewayLogFilters) {
    const logs = await this.repo.findGatewayLogs(filters);
    return { data: logs, total: logs.length };
  }

  async listDiagnosticEvents(filters: DiagnosticEventFilters) {
    const events = await this.repo.findDiagnosticEvents(filters);
    return { data: events, total: events.length };
  }

  // ─── Usage ───────────────────────────────────────────────────────

  async getUsageSummary(filters: { machineId?: string; agentId?: string }) {
    return this.repo.getUsageSummary(filters);
  }

  // ─── Dashboard ───────────────────────────────────────────────────

  async getDashboard(machineId?: string): Promise<MonitoringDashboard> {
    const [
      totalSessions,
      activeSessions,
      agentSummaries,
      recentEvents,
      errorCount,
    ] = await Promise.all([
      this.repo.countSessionSnapshots({ machineId }),
      this.repo.countSessionSnapshots({ machineId, activeMinutes: 30 }),
      this.repo.getAgentUsageSummaries(machineId),
      this.repo.findDiagnosticEvents({ machineId, limit: 20 }),
      this.repo.getRecentErrorCount(machineId, 60),
    ]);

    const totalTokens = agentSummaries.reduce((sum, a) => sum + a.totalTokens, 0);

    return {
      totalSessions,
      activeSessions,
      totalTokens,
      errorCount,
      agentSummaries,
      recentEvents,
    };
  }

  // ─── Sync Triggers ───────────────────────────────────────────────

  /**
   * Trigger a session sync for a specific machine. Also pulls transcripts
   * for sessions active in the configured summary window so the summaries
   * page has actual conversation content (session metadata sync alone
   * never populates session_messages).
   */
  async triggerSessionSync(machineId: string): Promise<{ synced: number; transcripts: number }> {
    let synced = await this.sessionMonitor.syncSessionsViaGateway(machineId);
    if (synced === 0) {
      const machine = await this.machineService.getMachine(machineId);
      const connInfo = this.machineService.toConnectionInfo(machine);
      synced = await this.sessionMonitor.syncSessionsViaSSH(machineId, connInfo, machine.openclawHome);
    }
    const { pulled } = await this.syncTranscriptsForActiveSessions(machineId);
    return { synced, transcripts: pulled };
  }

  /**
   * Trigger transcript pull for a specific session.
   */
  async triggerTranscriptPull(machineId: string, sessionKey: string, agentId: string): Promise<{ pulled: number }> {
    let pulled = await this.sessionMonitor.pullTranscriptViaGateway(machineId, sessionKey, agentId);
    if (pulled === 0) {
      // Fall back to SSH transcript pull
      const snapshot = await this.repo.findSessionSnapshotByKey(machineId, sessionKey);
      // Use sessionId from snapshot, or fall back to sessionKey for legacy formats
      const sessionId = snapshot?.sessionId ?? sessionKey;
      const machine = await this.machineService.getMachine(machineId);
      const connInfo = this.machineService.toConnectionInfo(machine);
      pulled = await this.sessionMonitor.pullTranscriptViaSSH(
        machineId, connInfo, machine.openclawHome, agentId, sessionId,
      );
    }
    return { pulled };
  }

  /**
   * Trigger log collection for a specific machine.
   */
  async triggerLogCollection(machineId: string): Promise<{ gateway: number; command: number; configAudit: number; cronRun: number }> {
    const machine = await this.machineService.getMachine(machineId);
    const connInfo = this.machineService.toConnectionInfo(machine);
    return this.logCollector.collectAllLogs(machineId, connInfo, machine.openclawHome);
  }

  /**
   * Sync sessions for all connected machines. Each tick:
   *   1. Refresh session_snapshots (metadata: tokens, last activity, etc.)
   *   2. Pull transcripts into session_messages for sessions active in
   *      the configured summary window. Without step 2, session_messages
   *      stays empty unless a user manually opens a session in the UI,
   *      and the scheduled summary job has nothing to summarize.
   */
  async syncAllMachineSessions(): Promise<{ snapshots: number; transcripts: number }> {
    const machines = await this.machineService.listMachines({ status: 'online' });
    let snapshots = 0;
    let transcripts = 0;
    for (const machine of machines) {
      try {
        let synced = await this.sessionMonitor.syncSessionsViaGateway(machine.id);
        if (synced === 0) {
          const connInfo = this.machineService.toConnectionInfo(machine);
          synced = await this.sessionMonitor.syncSessionsViaSSH(machine.id, connInfo, machine.openclawHome);
        }
        snapshots += synced;

        const { pulled } = await this.syncTranscriptsForActiveSessions(machine.id);
        transcripts += pulled;
      } catch (err) {
        log.warn({ machineId: machine.id, err: (err as Error).message }, 'Failed to sync sessions');
      }
    }
    return { snapshots, transcripts };
  }

  /**
   * Pull transcript messages into session_messages for every snapshot on
   * `machineId` whose last_activity_at falls inside the lookback window.
   *
   * Lookback defaults to summary windowHours + 1h margin, so sessions that
   * just rolled out of the summary window are still captured on the next
   * tick. Gateway is preferred; SSH is the fallback.
   *
   * Cost note: gateway returns the full message list per call but
   * `pullTranscriptViaGateway` uses `getMaxMessageIndex` to dedupe, so the
   * DB write side is cheap. The dominant cost is the per-session RPC; for
   * a 60s sync interval that's ~N RPCs/min where N = active sessions.
   */
  private async syncTranscriptsForActiveSessions(
    machineId: string,
    lookbackHours: number = config.summaries.windowHours + 1,
  ): Promise<{ sessions: number; pulled: number }> {
    const snapshots = await this.repo.findSessionSnapshots({
      machineId,
      activeMinutes: lookbackHours * 60,
      limit: 500,
    });

    if (snapshots.length === 0) return { sessions: 0, pulled: 0 };

    let machine: Awaited<ReturnType<MachineService['getMachine']>> | null = null;
    let pulled = 0;
    for (const snap of snapshots) {
      try {
        let n = await this.sessionMonitor.pullTranscriptViaGateway(
          machineId,
          snap.sessionKey,
          snap.agentId,
        );
        if (n === 0) {
          if (!machine) {
            machine = await this.machineService.getMachine(machineId);
          }
          const connInfo = this.machineService.toConnectionInfo(machine);
          const sessionId = snap.sessionId ?? snap.sessionKey;
          n = await this.sessionMonitor.pullTranscriptViaSSH(
            machineId,
            connInfo,
            machine.openclawHome,
            snap.agentId,
            sessionId,
          );
        }
        pulled += n;
      } catch (err) {
        log.warn(
          { machineId, sessionKey: snap.sessionKey, err: (err as Error).message },
          'Transcript pull failed during session sync',
        );
      }
    }

    if (pulled > 0) {
      log.debug(
        { machineId, sessions: snapshots.length, pulled },
        'Pulled transcripts for active sessions',
      );
    }
    return { sessions: snapshots.length, pulled };
  }

  /**
   * Collect logs from all machines via SSH.
   */
  async collectAllMachineLogs(): Promise<number> {
    const machines = await this.machineService.listMachines({ status: 'online' });
    let total = 0;
    for (const machine of machines) {
      try {
        const connInfo = this.machineService.toConnectionInfo(machine);
        const result = await this.logCollector.collectAllLogs(machine.id, connInfo, machine.openclawHome);
        total += result.gateway + result.command + result.configAudit + result.cronRun;
      } catch (err) {
        log.warn({ machineId: machine.id, err: (err as Error).message }, 'Failed to collect logs');
      }
    }
    return total;
  }
}
