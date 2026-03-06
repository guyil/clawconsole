import type { SSHPool, SSHConnectionInfo } from './ssh-pool.js';
import { SSHError } from '../shared/errors.js';
import { createChildLogger } from '../shared/logger.js';

const log = createChildLogger('ssh-executor');

export class SSHExecutor {
  constructor(private pool: SSHPool) {}

  async exec(
    info: SSHConnectionInfo,
    command: string,
    options: { timeoutMs?: number; allowNonZero?: boolean } = {},
  ): Promise<string> {
    log.debug({ machineId: info.machineId, command }, 'Executing SSH command');

    const result = await this.pool.executeCommand(info, command, {
      timeoutMs: options.timeoutMs,
    });

    if (result.exitCode !== 0 && !options.allowNonZero) {
      throw new SSHError(
        info.machineId,
        command,
        `Exit code ${result.exitCode}: ${result.stderr}`,
      );
    }

    return result.stdout;
  }

  async getOpenClawVersion(info: SSHConnectionInfo): Promise<string | null> {
    try {
      const output = await this.exec(info, 'openclaw --version 2>/dev/null || echo "not-installed"', {
        timeoutMs: 10_000,
        allowNonZero: true,
      });
      const version = output.trim();
      return version === 'not-installed' ? null : version;
    } catch {
      return null;
    }
  }

  async getGatewayStatus(info: SSHConnectionInfo): Promise<'active' | 'inactive' | 'unknown'> {
    try {
      const output = await this.exec(
        info,
        'systemctl --user is-active openclaw 2>/dev/null || echo "unknown"',
        { timeoutMs: 10_000, allowNonZero: true },
      );
      const status = output.trim();
      if (status === 'active') return 'active';
      if (status === 'inactive' || status === 'failed') return 'inactive';
      return 'unknown';
    } catch {
      return 'unknown';
    }
  }

  async restartGateway(info: SSHConnectionInfo): Promise<boolean> {
    try {
      await this.exec(info, 'systemctl --user restart openclaw', { timeoutMs: 30_000 });
      return true;
    } catch (err) {
      log.error({ machineId: info.machineId, err }, 'Gateway restart failed');
      return false;
    }
  }

  async runDoctor(info: SSHConnectionInfo, openclawHome: string): Promise<string> {
    return this.exec(
      info,
      `cd '${openclawHome}' && openclaw doctor --fix 2>&1`,
      { timeoutMs: 30_000, allowNonZero: true },
    );
  }
}
