import type { SSHPool, SSHConnectionInfo } from './ssh-pool.js';
import { createChildLogger } from '../shared/logger.js';
import { SSHError } from '../shared/errors.js';

const log = createChildLogger('file-transfer');

export class FileTransfer {
  private homeCache = new Map<string, string>();

  constructor(private pool: SSHPool) {}

  /**
   * Resolve leading ~ to the remote user's actual home directory.
   * Cached per machineId to avoid repeated SSH round-trips.
   */
  private async resolvePath(info: SSHConnectionInfo, remotePath: string): Promise<string> {
    if (!remotePath.startsWith('~')) return remotePath;

    let home = this.homeCache.get(info.machineId);
    if (!home) {
      const result = await this.pool.executeCommand(info, 'echo $HOME', { timeoutMs: 5_000 });
      home = result.stdout.trim();
      if (!home) {
        throw new SSHError(info.machineId, 'echo $HOME', 'Could not resolve home directory');
      }
      this.homeCache.set(info.machineId, home);
    }

    return remotePath.replace(/^~/, home);
  }

  async uploadFile(
    info: SSHConnectionInfo,
    remotePath: string,
    content: string,
    mode: number = 0o644,
  ): Promise<void> {
    const resolved = await this.resolvePath(info, remotePath);
    const client = await this.pool.getConnection(info);
    try {
      await new Promise<void>((resolve, reject) => {
        client.sftp((err, sftp) => {
          if (err) {
            reject(new SSHError(info.machineId, `sftp:upload:${resolved}`, err.message));
            return;
          }

          const writeStream = sftp.createWriteStream(resolved, { mode });
          writeStream.on('error', (writeErr: Error) => {
            reject(new SSHError(info.machineId, `sftp:write:${resolved}`, writeErr.message));
          });
          writeStream.on('close', () => {
            sftp.end();
            resolve();
          });
          writeStream.end(content, 'utf8');
        });
      });
      log.debug({ machineId: info.machineId, remotePath: resolved }, 'File uploaded');
    } finally {
      this.pool.releaseConnection(info.machineId, client);
    }
  }

  async downloadFile(info: SSHConnectionInfo, remotePath: string): Promise<string> {
    const resolved = await this.resolvePath(info, remotePath);
    const client = await this.pool.getConnection(info);
    try {
      return await new Promise<string>((resolve, reject) => {
        client.sftp((err, sftp) => {
          if (err) {
            reject(new SSHError(info.machineId, `sftp:download:${resolved}`, err.message));
            return;
          }

          let data = '';
          const readStream = sftp.createReadStream(resolved, { encoding: 'utf8' });
          readStream.on('data', (chunk: string) => { data += chunk; });
          readStream.on('error', (readErr: Error) => {
            sftp.end();
            reject(new SSHError(info.machineId, `sftp:read:${resolved}`, readErr.message));
          });
          readStream.on('end', () => {
            sftp.end();
            resolve(data);
          });
        });
      });
    } finally {
      this.pool.releaseConnection(info.machineId, client);
    }
  }

  async fileExists(info: SSHConnectionInfo, remotePath: string): Promise<boolean> {
    const resolved = await this.resolvePath(info, remotePath);
    const client = await this.pool.getConnection(info);
    try {
      return await new Promise<boolean>((resolve) => {
        client.sftp((err, sftp) => {
          if (err) { resolve(false); return; }
          sftp.stat(resolved, (statErr) => {
            sftp.end();
            resolve(!statErr);
          });
        });
      });
    } finally {
      this.pool.releaseConnection(info.machineId, client);
    }
  }

  async uploadCredential(
    info: SSHConnectionInfo,
    remotePath: string,
    decryptedValue: string,
  ): Promise<void> {
    return this.uploadFile(info, remotePath, decryptedValue, 0o600);
  }

  async ensureDirectory(info: SSHConnectionInfo, remoteDirPath: string): Promise<void> {
    const resolved = await this.resolvePath(info, remoteDirPath);
    const result = await this.pool.executeCommand(
      info,
      `mkdir -p '${resolved}'`,
      { timeoutMs: 10_000 },
    );
    if (result.exitCode !== 0) {
      throw new SSHError(info.machineId, `mkdir:${remoteDirPath}`, result.stderr);
    }
  }

  async removeDirectory(info: SSHConnectionInfo, remoteDirPath: string): Promise<void> {
    const resolved = await this.resolvePath(info, remoteDirPath);
    const result = await this.pool.executeCommand(
      info,
      `rm -rf '${resolved}'`,
      { timeoutMs: 15_000 },
    );
    if (result.exitCode !== 0) {
      throw new SSHError(info.machineId, `rm-rf:${remoteDirPath}`, result.stderr);
    }
    log.debug({ machineId: info.machineId, remoteDirPath: resolved }, 'Directory removed');
  }

  async deleteFile(info: SSHConnectionInfo, remotePath: string): Promise<void> {
    const resolved = await this.resolvePath(info, remotePath);
    const result = await this.pool.executeCommand(
      info,
      `rm -f '${resolved}'`,
      { timeoutMs: 10_000 },
    );
    if (result.exitCode !== 0) {
      throw new SSHError(info.machineId, `rm:${remotePath}`, result.stderr);
    }
  }

  async getRemoteFileHash(info: SSHConnectionInfo, remotePath: string): Promise<string | null> {
    try {
      const resolved = await this.resolvePath(info, remotePath);
      const result = await this.pool.executeCommand(
        info,
        `sha256sum '${resolved}' 2>/dev/null | cut -d' ' -f1`,
        { timeoutMs: 10_000 },
      );
      const hash = result.stdout.trim();
      return hash.length === 64 ? hash : null;
    } catch {
      return null;
    }
  }
}
