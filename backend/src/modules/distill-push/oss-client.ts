/**
 * Aliyun OSS client wrapper for clawconsole's direct-push distillation.
 *
 * Mirrors the platform-side ``app/services/oss_service.py`` settings so
 * objects written here land in the same bucket / prefix that mini-claw
 * reads back via `knowledge_hub/v1/scopes/...`.
 *
 * Configuration (env vars)
 * ------------------------
 *   ALIYUN_OSS_ACCESS_KEY_ID
 *   ALIYUN_OSS_ACCESS_KEY_SECRET
 *   ALIYUN_OSS_ENDPOINT        e.g. oss-cn-shenzhen.aliyuncs.com
 *   ALIYUN_OSS_REGION          e.g. oss-cn-shenzhen
 *   ALIYUN_OSS_BUCKET          e.g. claw-knowledge-hub
 *   ALIYUN_OSS_PREFIX          optional; applied to every object key
 *
 * We deliberately depend on the ``ali-oss`` package (the official SDK
 * used by the platform side) so the same bucket/region semantics apply.
 */
import { createChildLogger } from '../../shared/logger.js';

// Loaded lazily — clawconsole instances without OSS configured shouldn't
// fail to boot just because the module imports the client. Importing
// `ali-oss` itself is cheap; what's lazy is the credential check.
import OSS from 'ali-oss';

const log = createChildLogger('oss-client');

export interface OssConfig {
  accessKeyId: string;
  accessKeySecret: string;
  endpoint: string;
  region: string;
  bucket: string;
  prefix: string;
}

function readEnvConfig(): OssConfig | null {
  const accessKeyId = (process.env.ALIYUN_OSS_ACCESS_KEY_ID ?? '').trim();
  const accessKeySecret = (process.env.ALIYUN_OSS_ACCESS_KEY_SECRET ?? '').trim();
  const endpoint = (process.env.ALIYUN_OSS_ENDPOINT ?? '').trim();
  const region = (process.env.ALIYUN_OSS_REGION ?? '').trim();
  const bucket = (process.env.ALIYUN_OSS_BUCKET ?? '').trim();
  const prefix = (process.env.ALIYUN_OSS_PREFIX ?? '').trim().replace(/^\/+|\/+$/g, '');
  if (!accessKeyId || !accessKeySecret || !bucket || (!endpoint && !region)) {
    return null;
  }
  return { accessKeyId, accessKeySecret, endpoint, region, bucket, prefix };
}

export class OssClient {
  private readonly cfg: OssConfig;
  private readonly client: OSS;

  constructor(cfg: OssConfig) {
    this.cfg = cfg;
    this.client = new OSS({
      accessKeyId: cfg.accessKeyId,
      accessKeySecret: cfg.accessKeySecret,
      bucket: cfg.bucket,
      endpoint: cfg.endpoint || undefined,
      region: cfg.region || undefined,
      // ali-oss defaults ``timeout`` to 60_000ms (see
      // node_modules/ali-oss/lib/common/client/initOptions.js). 60s is
      // fine for a fresh persona upload but bites the moment we push a
      // multi-megabyte vector sqlite from inside ap-southeast-1 across
      // a less-than-perfect link, surfacing as
      //   "Response timeout for 60000ms ..."
      // and failing the whole agent's distill in the BullMQ worker.
      // 5 min is well under the per-agent BullMQ deadline
      // (config.dailyOssBackup.perAgentTimeoutMs = 600_000) and
      // matches mini-claw's Python OSS service which uses a 300s
      // request timeout for the same workload.
      timeout: 300_000,
      // Keep alive a generous pool — distill push uploads many small
      // files in parallel and OSS routinely caps a single connection at
      // 10 concurrent requests. Matches the Python side's pool_size=64.
      // (`ali-oss` exposes this via the `agent` option, but the default
      //  agent.maxSockets is high enough; we leave it untouched here.)
    });
  }

  static fromEnv(): OssClient | null {
    const cfg = readEnvConfig();
    if (!cfg) {
      log.warn('OSS env not fully configured — distill-push OSS upload disabled');
      return null;
    }
    return new OssClient(cfg);
  }

  /** Full OSS key with the deployment-level prefix applied. */
  fullKey(relativeKey: string): string {
    const cleaned = relativeKey.replace(/^\/+/, '');
    return this.cfg.prefix ? `${this.cfg.prefix}/${cleaned}` : cleaned;
  }

  async putBuffer(
    key: string,
    body: Buffer,
    contentType?: string,
  ): Promise<void> {
    const headers: Record<string, string> = {};
    if (contentType) headers['Content-Type'] = contentType;
    await this.client.put(this.fullKey(key), body, { headers });
  }

  async putString(
    key: string,
    body: string,
    contentType: string = 'text/plain; charset=utf-8',
  ): Promise<void> {
    await this.putBuffer(key, Buffer.from(body, 'utf8'), contentType);
  }

  async getBuffer(key: string): Promise<Buffer | null> {
    try {
      const res = await this.client.get(this.fullKey(key));
      return res.content as Buffer;
    } catch (err) {
      const status = (err as { status?: number; code?: string }).status;
      const code = (err as { status?: number; code?: string }).code;
      if (status === 404 || code === 'NoSuchKey') return null;
      throw err;
    }
  }

  async getString(key: string): Promise<string | null> {
    const buf = await this.getBuffer(key);
    return buf === null ? null : buf.toString('utf8');
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.head(this.fullKey(key));
      return true;
    } catch (err) {
      const status = (err as { status?: number; code?: string }).status;
      const code = (err as { status?: number; code?: string }).code;
      if (status === 404 || code === 'NoSuchKey') return false;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.client.delete(this.fullKey(key));
    } catch (err) {
      const status = (err as { status?: number; code?: string }).status;
      const code = (err as { status?: number; code?: string }).code;
      if (status === 404 || code === 'NoSuchKey') return;
      throw err;
    }
  }

  /** List object keys directly under a prefix; non-recursive. */
  async listChildKeys(prefix: string): Promise<string[]> {
    return this.listKeysImpl(prefix, '/');
  }

  /** List every object key under a prefix (recursive). */
  async listAllKeys(prefix: string): Promise<string[]> {
    return this.listKeysImpl(prefix, '');
  }

  private async listKeysImpl(prefix: string, delimiter: string): Promise<string[]> {
    const fullPrefix = this.fullKey(prefix);
    const normalizedPrefix = fullPrefix.endsWith('/') ? fullPrefix : `${fullPrefix}/`;
    const out: string[] = [];
    let continuationToken: string | undefined;
    do {
      const params: Record<string, unknown> = {
        prefix: normalizedPrefix,
        'max-keys': 1000,
        'continuation-token': continuationToken,
      };
      if (delimiter) params['delimiter'] = delimiter;
      const res = await this.client.listV2(params as Parameters<typeof this.client.listV2>[0], {});
      for (const obj of res.objects ?? []) {
        if (obj.name && obj.name !== normalizedPrefix) out.push(obj.name);
      }
      continuationToken = res.nextContinuationToken;
    } while (continuationToken);
    return out;
  }

  /** Convert a fully-prefixed key back to a relative key (drops deployment prefix). */
  toRelativeKey(fullKey: string): string {
    if (!this.cfg.prefix) return fullKey;
    const head = `${this.cfg.prefix}/`;
    return fullKey.startsWith(head) ? fullKey.slice(head.length) : fullKey;
  }
}
