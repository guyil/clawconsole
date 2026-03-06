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
import { createChildLogger } from '../../shared/logger.js';

const log = createChildLogger('monitoring-service');

export class MonitoringService {
  constructor(
    private repo: MonitoringRepository,
    private sessionMonitor: SessionMonitorService,
    private logCollector: LogCollectorService,
    private gatewayPool: GatewayConnectorPool,
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
   * Trigger a session sync for a specific machine.
   */
  async triggerSessionSync(machineId: string): Promise<{ synced: number }> {
    // Try gateway first, fall back to SSH
    let synced = await this.sessionMonitor.syncSessionsViaGateway(machineId);
    if (synced === 0) {
      const machine = await this.machineService.getMachine(machineId);
      const connInfo = this.machineService.toConnectionInfo(machine);
      synced = await this.sessionMonitor.syncSessionsViaSSH(machineId, connInfo, machine.openclawHome);
    }
    return { synced };
  }

  /**
   * Trigger transcript pull for a specific session.
   */
  async triggerTranscriptPull(machineId: string, sessionKey: string, agentId: string): Promise<{ pulled: number }> {
    let pulled = await this.sessionMonitor.pullTranscriptViaGateway(machineId, sessionKey, agentId);
    if (pulled === 0) {
      // Fall back to SSH transcript pull
      const snapshot = await this.repo.findSessionSnapshotByKey(machineId, sessionKey);
      if (snapshot?.sessionId) {
        const machine = await this.machineService.getMachine(machineId);
        const connInfo = this.machineService.toConnectionInfo(machine);
        pulled = await this.sessionMonitor.pullTranscriptViaSSH(
          machineId, connInfo, machine.openclawHome, agentId, snapshot.sessionId,
        );
      }
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
   * Sync sessions for all connected machines.
   */
  async syncAllMachineSessions(): Promise<number> {
    const machines = await this.machineService.listMachines({ status: 'online' });
    let total = 0;
    for (const machine of machines) {
      try {
        let synced = await this.sessionMonitor.syncSessionsViaGateway(machine.id);
        if (synced === 0) {
          const connInfo = this.machineService.toConnectionInfo(machine);
          synced = await this.sessionMonitor.syncSessionsViaSSH(machine.id, connInfo, machine.openclawHome);
        }
        total += synced;
      } catch (err) {
        log.warn({ machineId: machine.id, err: (err as Error).message }, 'Failed to sync sessions');
      }
    }
    return total;
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
