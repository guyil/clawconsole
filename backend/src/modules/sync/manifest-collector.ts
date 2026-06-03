import type { SSHPool, SSHConnectionInfo } from '../../transport/ssh-pool.js';
import type { RemoteManifest, ManifestEntry } from './sync.types.js';
import { isExcludedFromSync } from '../../shared/file-classifier.js';
import { createChildLogger } from '../../shared/logger.js';
import { getRedis } from '../../shared/redis.js';
import { config } from '../../config/index.js';

const log = createChildLogger('manifest-collector');

// Hard cap on per-file size that we will sha256 + ship over the wire.
// Anything larger is presumed to be a runtime artifact (session jsonl
// archives, large PDFs ingested into ``workspace/``, sessions.json.bak,
// gateway.log, etc.) that the console does not need to mirror. Without
// this cap a single 100MB+ file produces a ~200MB V8 string in
// ``downloadFile`` and OOMs the backend.
const MANIFEST_MAX_FILE_BYTES = 10 * 1024 * 1024;

const MANIFEST_SCRIPT = `
cd "\${OPENCLAW_HOME:-\$HOME/.openclaw}" 2>/dev/null || exit 1
find . -type f \\
  -size -${MANIFEST_MAX_FILE_BYTES}c \\
  ! -path './.git/*' \\
  ! -path '*/node_modules/*' \\
  ! -path './browser/*' \\
  ! -path './canvas/*' \\
  ! -path './completions/*' \\
  ! -path './identity/*' \\
  ! -path './archives/*' \\
  ! -path './session-archives/*' \\
  ! -path './plugin-runtime-deps/*' \\
  ! -name '*.sqlite' \\
  ! -name '*.sqlite-wal' \\
  ! -name '*.sqlite-shm' \\
  ! -name '*.pdf' \\
  ! -name '*.zip' \\
  ! -name '*.tar' \\
  ! -name '*.gz' \\
  ! -name '*.tar.gz' \\
  ! -name '*.tgz' \\
  ! -name '*.log' \\
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

    // Expand a leading `~/` to `$HOME/` so the script's `cd "<path>"` works
    // under bash. Inside double quotes bash does NOT expand tilde, so a path
    // like `~/.openclaw` would resolve to a literal directory named `~`,
    // `cd` would fail, and `find` would silently return zero entries.
    // We rely on the remote shell to expand `$HOME` at runtime.
    const homePath = openclawHome.startsWith('~/')
      ? openclawHome.replace('~', '$HOME')
      : openclawHome;
    const script = MANIFEST_SCRIPT.replace(
      '${OPENCLAW_HOME:-$HOME/.openclaw}',
      homePath,
    );

    // Cap stdout at 32 MiB. Charlie currently produces ~15 MiB for ~100k
    // files; if it ever doubles we'll loudly fail this manifest collection
    // (and the auto-pull job for that machine that cycle) instead of
    // silently leaking memory until the backend OOMs. See ssh-pool's
    // ``executeCommand`` for the streaming abort.
    const result = await this.sshPool.executeCommand(connectionInfo, script, {
      timeoutMs: 60_000,
      maxStdoutBytes: 32 * 1024 * 1024,
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
      // Belt-and-suspenders: even if the remote ``find -size`` predicate
      // didn't fire (e.g. a future BSD/GNU find quirk), refuse to ship
      // anything bigger than the cap so ``downloadFile`` cannot blow the
      // backend heap.
      if (size > MANIFEST_MAX_FILE_BYTES) continue;

      entries.push({ relativePath, hash, size, mtime });
    }

    return entries;
  }
}
