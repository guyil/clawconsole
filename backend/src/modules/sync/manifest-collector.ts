import type { SSHPool, SSHConnectionInfo } from '../../transport/ssh-pool.js';
import type { RemoteManifest, ManifestEntry } from './sync.types.js';
import { isExcludedFromSync } from '../../shared/file-classifier.js';
import { createChildLogger } from '../../shared/logger.js';
import { getRedis } from '../../shared/redis.js';
import { config } from '../../config/index.js';

const log = createChildLogger('manifest-collector');

const MANIFEST_SCRIPT = `
cd "\${OPENCLAW_HOME:-\$HOME/.openclaw}" 2>/dev/null || exit 1
find . -type f \\
  ! -path './.git/*' \\
  ! -path '*/node_modules/*' \\
  ! -path './browser/*' \\
  ! -path './canvas/*' \\
  ! -path './completions/*' \\
  ! -path './identity/*' \\
  ! -name '*.sqlite' \\
  ! -name '*.sqlite-wal' \\
  ! -name '*.sqlite-shm' \\
  -print0 2>/dev/null | while IFS= read -r -d '' file; do
    hash=$(sha256sum "$file" 2>/dev/null | cut -d' ' -f1)
    if [ -n "$hash" ]; then
      size=$(stat -c '%s' "$file" 2>/dev/null || stat -f '%z' "$file" 2>/dev/null)
      mtime=$(stat -c '%Y' "$file" 2>/dev/null || stat -f '%m' "$file" 2>/dev/null)
      echo "\${file}|\${hash}|\${size}|\${mtime}"
    fi
done
`.trim();

export class ManifestCollector {
  constructor(private sshPool: SSHPool) {}

  async collect(
    connectionInfo: SSHConnectionInfo,
    openclawHome: string,
  ): Promise<RemoteManifest> {
    const cacheKey = `manifest:${connectionInfo.machineId}`;
    const redis = getRedis();

    const cached = await redis.get(cacheKey);
    if (cached) {
      log.debug({ machineId: connectionInfo.machineId }, 'Using cached manifest');
      return JSON.parse(cached) as RemoteManifest;
    }

    log.info({ machineId: connectionInfo.machineId }, 'Collecting remote manifest');

    const script = MANIFEST_SCRIPT.replace(
      '${OPENCLAW_HOME:-$HOME/.openclaw}',
      openclawHome,
    );

    const result = await this.sshPool.executeCommand(connectionInfo, script, {
      timeoutMs: 60_000,
    });

    const entries = this.parseManifestOutput(result.stdout);
    const manifest: RemoteManifest = {
      machineId: connectionInfo.machineId,
      collectedAt: new Date(),
      entries,
    };

    await redis.set(cacheKey, JSON.stringify(manifest), 'EX', config.sync.manifestCacheTtlS);
    log.info(
      { machineId: connectionInfo.machineId, fileCount: entries.length },
      'Manifest collected',
    );

    return manifest;
  }

  async invalidateCache(machineId: string): Promise<void> {
    const redis = getRedis();
    await redis.del(`manifest:${machineId}`);
  }

  private parseManifestOutput(output: string): ManifestEntry[] {
    const entries: ManifestEntry[] = [];

    for (const line of output.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      const parts = trimmed.split('|');
      if (parts.length < 4) continue;

      const relativePath = parts[0].replace(/^\.\//, '');
      const hash = parts[1];
      const size = parseInt(parts[2], 10);
      const mtime = parseInt(parts[3], 10);

      if (!hash || hash.length !== 64) continue;
      if (isNaN(size) || isNaN(mtime)) continue;
      if (isExcludedFromSync(relativePath)) continue;

      entries.push({ relativePath, hash, size, mtime });
    }

    return entries;
  }
}
