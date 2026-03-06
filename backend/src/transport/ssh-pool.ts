import { Client, type ConnectConfig } from 'ssh2';
import { config } from '../config/index.js';
import { createChildLogger } from '../shared/logger.js';
import { MachineUnreachableError, SSHError } from '../shared/errors.js';

const log = createChildLogger('ssh-pool');

export interface SSHConnectionInfo {
  machineId: string;
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKeyPath?: string;
}

interface PooledConnection {
  client: Client;
  info: SSHConnectionInfo;
  createdAt: number;
  lastUsedAt: number;
  inUse: boolean;
}

export class SSHPool {
  private connections = new Map<string, PooledConnection[]>();
  private maxPerMachine = config.ssh.maxConnectionsPerMachine;
  private idleTimeoutMs = config.ssh.idleTimeoutMs;
  private connectionTimeoutMs = config.ssh.connectionTimeoutMs;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.cleanupInterval = setInterval(() => this.cleanupIdle(), 60_000);
  }

  async getConnection(info: SSHConnectionInfo): Promise<Client> {
    const pool = this.connections.get(info.machineId) ?? [];
    this.connections.set(info.machineId, pool);

    const idle = pool.find((c) => !c.inUse && this.isAlive(c));
    if (idle) {
      idle.inUse = true;
      idle.lastUsedAt = Date.now();
      log.debug({ machineId: info.machineId }, 'Reusing SSH connection');
      return idle.client;
    }

    if (pool.length >= this.maxPerMachine) {
      const oldest = pool.find((c) => !c.inUse);
      if (oldest) {
        oldest.client.end();
        pool.splice(pool.indexOf(oldest), 1);
      } else {
        throw new MachineUnreachableError(
          info.machineId,
          `All ${this.maxPerMachine} SSH connections are in use`,
        );
      }
    }

    const client = await this.createConnection(info);
    const pooled: PooledConnection = {
      client,
      info,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      inUse: true,
    };
    pool.push(pooled);

    return client;
  }

  releaseConnection(machineId: string, client: Client): void {
    const pool = this.connections.get(machineId);
    if (!pool) return;

    const entry = pool.find((c) => c.client === client);
    if (entry) {
      entry.inUse = false;
      entry.lastUsedAt = Date.now();
    }
  }

  async executeCommand(
    info: SSHConnectionInfo,
    command: string,
    options: { timeoutMs?: number } = {},
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const client = await this.getConnection(info);
    try {
      return await new Promise((resolve, reject) => {
        const timeoutMs = options.timeoutMs ?? 30_000;
        const timer = setTimeout(() => {
          reject(new SSHError(info.machineId, command, `Command timed out after ${timeoutMs}ms`));
        }, timeoutMs);

        client.exec(command, (err, stream) => {
          if (err) {
            clearTimeout(timer);
            reject(new SSHError(info.machineId, command, err.message));
            return;
          }

          let stdout = '';
          let stderr = '';

          stream.on('data', (data: Buffer) => { stdout += data.toString(); });
          stream.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

          stream.on('close', (code: number) => {
            clearTimeout(timer);
            resolve({ stdout, stderr, exitCode: code ?? 0 });
          });
        });
      });
    } finally {
      this.releaseConnection(info.machineId, client);
    }
  }

  private createConnection(info: SSHConnectionInfo): Promise<Client> {
    return new Promise((resolve, reject) => {
      const client = new Client();
      const timer = setTimeout(() => {
        client.end();
        reject(new MachineUnreachableError(info.machineId, 'SSH connection timeout'));
      }, this.connectionTimeoutMs);

      const connectConfig: ConnectConfig = {
        host: info.host,
        port: info.port,
        username: info.username,
        readyTimeout: this.connectionTimeoutMs,
      };

      if (info.password) {
        connectConfig.password = info.password;
      } else {
        connectConfig.agent = process.env.SSH_AUTH_SOCK;
      }

      client
        .on('ready', () => {
          clearTimeout(timer);
          log.info({ machineId: info.machineId, host: info.host }, 'SSH connection established');
          resolve(client);
        })
        .on('error', (err) => {
          clearTimeout(timer);
          log.error({ machineId: info.machineId, err }, 'SSH connection error');
          reject(new MachineUnreachableError(info.machineId, err.message));
        })
        .connect(connectConfig);
    });
  }

  private isAlive(conn: PooledConnection): boolean {
    try {
      return (conn.client as unknown as { _sock?: { writable?: boolean } })._sock?.writable !== false;
    } catch {
      return false;
    }
  }

  private cleanupIdle(): void {
    const now = Date.now();
    for (const [machineId, pool] of this.connections) {
      const toRemove: number[] = [];
      for (let i = 0; i < pool.length; i++) {
        const conn = pool[i];
        if (!conn.inUse && now - conn.lastUsedAt > this.idleTimeoutMs) {
          conn.client.end();
          toRemove.push(i);
        }
      }
      for (const idx of toRemove.reverse()) {
        pool.splice(idx, 1);
      }
      if (pool.length === 0) {
        this.connections.delete(machineId);
      }
    }
  }

  async destroy(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    for (const pool of this.connections.values()) {
      for (const conn of pool) {
        conn.client.end();
      }
    }
    this.connections.clear();
    log.info('SSH pool destroyed');
  }
}
