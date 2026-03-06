import type { SSHPool, SSHConnectionInfo } from '../../transport/ssh-pool.js';
import type { MonitoringRepository } from './monitoring.repository.js';
import type { InsertGatewayLogInput, InsertDiagnosticEventInput, LogSource } from './monitoring.types.js';
import { createChildLogger } from '../../shared/logger.js';

const log = createChildLogger('log-collector');

// Limit how many lines we parse per collection run to avoid memory issues
const MAX_LINES_PER_FILE = 5000;

export class LogCollectorService {
  constructor(
    private repo: MonitoringRepository,
    private sshPool: SSHPool,
  ) {}

  /**
   * Collect all log types from a machine.
   */
  async collectAllLogs(machineId: string, connInfo: SSHConnectionInfo, openclawHome: string): Promise<{
    gateway: number;
    command: number;
    configAudit: number;
    cronRun: number;
  }> {
    // Expand ~ to $HOME for safe use inside double-quoted SSH commands
    const home = openclawHome.startsWith('~/')
      ? openclawHome.replace('~', '$HOME')
      : openclawHome;

    const [gateway, command, configAudit, cronRun] = await Promise.all([
      this.collectGatewayLogs(machineId, connInfo, home),
      this.collectCommandLogs(machineId, connInfo, home),
      this.collectConfigAuditLogs(machineId, connInfo, home),
      this.collectCronRunLogs(machineId, connInfo, home),
    ]);

    log.info(
      { machineId, gateway, command, configAudit, cronRun },
      'Log collection complete',
    );

    return { gateway, command, configAudit, cronRun };
  }

  /**
   * Collect gateway.log entries (JSONL format).
   */
  async collectGatewayLogs(machineId: string, connInfo: SSHConnectionInfo, openclawHome: string): Promise<number> {
    const lastTs = await this.repo.getLatestLogTimestamp(machineId, 'gateway');
    const logPath = `${openclawHome}/logs/gateway.log`;

    return this.collectJsonlLogFile(machineId, connInfo, logPath, 'gateway', lastTs, (parsed) => {
      const time = parsed._time ?? parsed.time;
      const loggedAt = time ? new Date(time as string | number).toISOString() : new Date().toISOString();

      return {
        machineId,
        logSource: 'gateway' as LogSource,
        level: parsed.level as string ?? parsed._level as string,
        subsystem: parsed.subsystem as string ?? parsed._subsystem as string,
        message: parsed.message as string ?? parsed.msg as string,
        sessionKey: parsed.sessionKey as string,
        sessionId: parsed.sessionId as string,
        agentId: parsed.agentId as string,
        channel: parsed.channel as string,
        loggedAt,
      };
    });
  }

  /**
   * Collect commands.log entries (JSONL format).
   */
  async collectCommandLogs(machineId: string, connInfo: SSHConnectionInfo, openclawHome: string): Promise<number> {
    const lastTs = await this.repo.getLatestLogTimestamp(machineId, 'command');
    const logPath = `${openclawHome}/logs/commands.log`;

    return this.collectJsonlLogFile(machineId, connInfo, logPath, 'command', lastTs, (parsed) => {
      const timestamp = parsed.timestamp as string;
      const loggedAt = timestamp ? new Date(timestamp).toISOString() : new Date().toISOString();

      return {
        machineId,
        logSource: 'command' as LogSource,
        level: 'info',
        message: `${parsed.action ?? 'command'}`,
        sessionKey: parsed.sessionKey as string,
        agentId: parsed.agentId as string,
        extraData: {
          action: parsed.action,
          senderId: parsed.senderId,
          source: parsed.source,
        },
        loggedAt,
      };
    });
  }

  /**
   * Collect config-audit.jsonl entries.
   */
  async collectConfigAuditLogs(machineId: string, connInfo: SSHConnectionInfo, openclawHome: string): Promise<number> {
    const lastTs = await this.repo.getLatestLogTimestamp(machineId, 'config_audit');
    const logPath = `${openclawHome}/logs/config-audit.jsonl`;

    return this.collectJsonlLogFile(machineId, connInfo, logPath, 'config_audit', lastTs, (parsed) => {
      const ts = parsed.ts as number;
      const loggedAt = ts ? new Date(ts).toISOString() : new Date().toISOString();

      return {
        machineId,
        logSource: 'config_audit' as LogSource,
        level: parsed.result === 'failed' ? 'error' : 'info',
        message: `config.write: ${parsed.result}`,
        extraData: {
          event: parsed.event,
          result: parsed.result,
          configPath: parsed.configPath,
          changedPathCount: parsed.changedPathCount,
          previousHash: parsed.previousHash,
          nextHash: parsed.nextHash,
          suspicious: parsed.suspicious,
        },
        loggedAt,
      };
    });
  }

  /**
   * Collect cron run logs from cron/runs/*.jsonl.
   */
  async collectCronRunLogs(machineId: string, connInfo: SSHConnectionInfo, openclawHome: string): Promise<number> {
    try {
      const { stdout: files } = await this.sshPool.executeCommand(
        connInfo,
        `ls -1 ${openclawHome}/cron/runs/*.jsonl 2>/dev/null || true`,
        { timeoutMs: 10_000 },
      );

      const filePaths = files.split('\n').filter(Boolean);
      if (filePaths.length === 0) return 0;

      const lastTs = await this.repo.getLatestLogTimestamp(machineId, 'cron_run');
      let totalCollected = 0;

      for (const filePath of filePaths) {
        const count = await this.collectJsonlLogFile(
          machineId,
          connInfo,
          filePath,
          'cron_run',
          lastTs,
          (parsed) => {
            const ts = parsed.ts as number;
            const loggedAt = ts ? new Date(ts).toISOString() : new Date().toISOString();

            return {
              machineId,
              logSource: 'cron_run' as LogSource,
              level: parsed.status === 'error' ? 'error' : 'info',
              message: parsed.summary as string ?? `cron:${parsed.jobId}:${parsed.status}`,
              sessionKey: parsed.sessionKey as string,
              sessionId: parsed.sessionId as string,
              extraData: {
                jobId: parsed.jobId,
                status: parsed.status,
                error: parsed.error,
                durationMs: parsed.durationMs,
                model: parsed.model,
                provider: parsed.provider,
                usage: parsed.usage,
                deliveryStatus: parsed.deliveryStatus,
              },
              loggedAt,
            };
          },
        );
        totalCollected += count;
      }

      return totalCollected;
    } catch (err) {
      log.error({ machineId, err: (err as Error).message }, 'Failed to collect cron run logs');
      return 0;
    }
  }

  /**
   * Store a diagnostic event from a gateway WebSocket event.
   */
  async storeDiagnosticEvent(machineId: string, event: { event: string; payload: unknown }): Promise<void> {
    const payload = (event.payload ?? {}) as Record<string, unknown>;

    const input: InsertDiagnosticEventInput = {
      machineId,
      eventType: event.event,
      sessionKey: payload.sessionKey as string,
      sessionId: payload.sessionId as string,
      channel: payload.channel as string,
      provider: payload.provider as string,
      model: payload.model as string,
      durationMs: payload.durationMs as number,
      outcome: payload.outcome as string,
      errorMessage: payload.error as string,
      eventAt: new Date().toISOString(),
    };

    // Extract token usage if present
    if (payload.usage && typeof payload.usage === 'object') {
      input.tokenUsage = payload.usage as Record<string, unknown>;
    }

    // Store remaining payload as extra data
    const knownKeys = new Set([
      'sessionKey', 'sessionId', 'channel', 'provider', 'model',
      'durationMs', 'outcome', 'error', 'usage',
    ]);
    const extra: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(payload)) {
      if (!knownKeys.has(key)) {
        extra[key] = value;
      }
    }
    if (Object.keys(extra).length > 0) {
      input.extraData = extra;
    }

    await this.repo.insertDiagnosticEvents([input]);
  }

  // ─── Private Helpers ─────────────────────────────────────────────

  private async collectJsonlLogFile(
    machineId: string,
    connInfo: SSHConnectionInfo,
    filePath: string,
    logSource: LogSource,
    lastTs: string | null,
    mapper: (parsed: Record<string, unknown>) => InsertGatewayLogInput,
  ): Promise<number> {
    try {
      // Read the tail of the file to limit memory usage
      const { stdout: content } = await this.sshPool.executeCommand(
        connInfo,
        `tail -n ${MAX_LINES_PER_FILE} "${filePath}" 2>/dev/null || true`,
        { timeoutMs: 30_000 },
      );

      if (!content.trim()) return 0;

      const lines = content.split('\n').filter(Boolean);
      const inputs: InsertGatewayLogInput[] = [];

      for (const line of lines) {
        try {
          const parsed = JSON.parse(line) as Record<string, unknown>;
          const input = mapper(parsed);

          // Skip entries we've already collected
          if (lastTs && input.loggedAt <= lastTs) continue;

          inputs.push(input);
        } catch {
          // Skip unparseable lines
        }
      }

      if (inputs.length > 0) {
        await this.repo.insertGatewayLogs(inputs);
      }

      log.debug({ machineId, logSource, filePath, count: inputs.length }, 'Collected log entries');
      return inputs.length;
    } catch (err) {
      log.warn({ machineId, logSource, filePath, err: (err as Error).message }, 'Failed to collect log file');
      return 0;
    }
  }
}
