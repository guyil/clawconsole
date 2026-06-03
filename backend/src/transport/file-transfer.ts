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

  /**
   * Bulk-download many small text files in a single SSH `exec` round-trip.
   *
   * SFTP requires open/read/close per file (multiple RTTs each); over a
   * Tailscale link that costs ~2s per small file even with parallel SFTP
   * channels. This shell-based approach completes in a few seconds total
   * because the remote shell `cat`s every file (base64-encoded for safe
   * delimiting) into one continuous stdout stream and the client simply
   * splits by a unique sentinel.
   *
   * `paths` must be already-resolved absolute paths (no `~`). On any
   * per-file error the corresponding entry in the result array is `null`.
   */
  async downloadFilesBulk(
    info: SSHConnectionInfo,
    paths: string[],
  ): Promise<(string | null)[]> {
    if (paths.length === 0) return [];
    for (const p of paths) {
      if (!p.startsWith('/')) {
        throw new SSHError(info.machineId, 'bulk-download', `Path must be absolute: ${p}`);
      }
      if (p.includes('\n') || p.includes("'")) {
        throw new SSHError(info.machineId, 'bulk-download', `Unsafe path: ${p}`);
      }
    }

    // Sentinel chosen so it can never appear inside base64 output.
    const sep = `===CLAWFILE===`;
    // Per file: emit `===CLAWFILE===<status>\n<base64>\n`. status is OK or MISSING.
    const list = paths.map((p) => `'${p}'`).join(' ');
    const cmd =
      `for f in ${list}; do ` +
      `if [ -f "$f" ]; then printf '%s\\n' '${sep}OK'; base64 < "$f"; ` +
      `else printf '%s\\n' '${sep}MISSING'; fi; ` +
      `done`;

    const { stdout } = await this.pool.executeCommand(info, cmd, {
      timeoutMs: 60_000,
    });

    const segments = stdout.split(sep).slice(1); // first element is empty
    const results: (string | null)[] = new Array(paths.length).fill(null);
    for (let i = 0; i < Math.min(paths.length, segments.length); i++) {
      const seg = segments[i];
      const nlIdx = seg.indexOf('\n');
      if (nlIdx === -1) continue;
      const status = seg.slice(0, nlIdx).trim();
      if (status !== 'OK') continue;
      const b64 = seg.slice(nlIdx + 1).replace(/\s+/g, '');
      try {
        results[i] = Buffer.from(b64, 'base64').toString('utf8');
      } catch (err) {
        log.warn(
          { machineId: info.machineId, path: paths[i], err: (err as Error).message },
          'bulk download: base64 decode failed',
        );
      }
    }
    return results;
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
