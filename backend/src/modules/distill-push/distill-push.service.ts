/**
 * OSS-direct distill push orchestrator (mini-claw OSS-sync 重构).
 *
 * Flow per agent
 * --------------
 *   step 1: 解析 openclaw 机器信息 + agent 元数据
 *   step 1.5: ``openclaw memory index --agent <id>`` 增量补齐自上次 index
 *           以来新增 / 修改的 memory 文件（默认非 --force：跳过 mtime
 *           没变的文件，空跑 ~6s）。如果不做这步，``snapshotRemoteSqlite``
 *           会复制一份"旧 index 的快照"——同步到 OSS 后 mini-claw 端
 *           ``search_memory`` 永远查不到最近一天写入的 memory（raw
 *           memory 步会传文件但 vector/FTS5 表里没有它们的 chunk）。
 *   step 2: 对源机 sqlite 做 `wal_checkpoint(TRUNCATE)` 后 `VACUUM INTO`
 *           生成一个一致快照（远程执行）
 *   step 3: 计算 agent_key = `oc-<machine_alias>-<agent_id>`
 *   step 4: memory raw files 增量上传 —— 以 openclaw 本地 sqlite 的
 *           `files` 表 (path + hash) 为权威 diff 源；只动差量
 *   step 5: skill 文件夹整目录遍历，每个 skill_key 生成 manifest.json，
 *           增量上传变更文件
 *   step 6: 上传 vector/memory.sqlite + meta.json
 *   step 7: 调 mini-claw `/openclaw/sync-completed` webhook 通知平台
 *
 * 实现注意
 * --------
 * - SSH 侧只跑只读 / 受限 mutating 命令（wal_checkpoint + VACUUM INTO
 *   分别对源 sqlite 与临时快照），不会改 openclaw 主库 schema。
 * - VACUUM INTO 写到 `~/.openclaw/.distill-snapshots/<agent_key>.sqlite`
 *   后通过 sftp 拉回本地 `tmp/`，上传 OSS，再清理。
 * - hashing 全部用 sha256，与平台 ``agent_memory_service._sha256_hex``
 *   保持一致；manifest 字段名严格对齐 ``agent_skill_oss_service``。
 */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { createChildLogger } from '../../shared/logger.js';
import type { SSHPool, SSHConnectionInfo } from '../../transport/ssh-pool.js';
import type { FileTransfer } from '../../transport/file-transfer.js';
import type { MachineRepository } from '../machines/machine.repository.js';
import type { AgentRepository } from '../agents/agent.repository.js';

import { OssClient } from './oss-client.js';
import {
  agentMemoryRawKey,
  agentPersonaFileKey,
  agentPersonaManifestKey,
  agentPersonaPrefix,
  agentPrefix as _agentPrefix,
  agentSkillFileKey,
  agentSkillManifestKey,
  agentVectorMetaKey,
  agentVectorSqliteKey,
  joinKey,
  slugifyAgentKey,
} from './knowledge-hub-paths.js';

function agentMemoryRawPrefix(agentKey: string): string {
  return joinKey(_agentPrefix(agentKey), 'raw');
}

const log = createChildLogger('distill-push');

const SHARED_OPENCLAW_VECTOR_MODEL =
  process.env.OPENCLAW_VECTOR_MODEL ?? 'text-embedding-3-small';
const SHARED_OPENCLAW_VECTOR_DIM = Number(
  process.env.OPENCLAW_VECTOR_DIM ?? 1536,
);
const SHARED_OPENCLAW_VECTOR_PROVIDER =
  process.env.OPENCLAW_VECTOR_PROVIDER ?? 'openai';

const MINICLAW_BASE_URL =
  (process.env.MINICLAW_BASE_URL ?? '').replace(/\/+$/, '');
const MINICLAW_SERVICE_TOKEN = (
  process.env.MINICLAW_DISTILL_SERVICE_TOKEN ?? ''
).trim();

function sha256OfBuffer(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Persona file set (canonical order = display order; manifest SHA is
 * deterministic regardless because entries are sorted by path before
 * signing).  Keep in lockstep with
 * ``framework/backend/app/services/agent_persona_oss_service.py:PERSONA_FILES``.
 */
const PERSONA_FILES: ReadonlyArray<string> = [
  'SOUL.md',
  'USER.md',
  'IDENTITY.md',
  'AGENTS.md',
  'TOOLS.md',
];

/**
 * Files that must NEVER reach the persona folder — they're openclaw
 * runtime scaffolding with no mini-claw analogue. Mirrors
 * ``agent_persona_oss_service.PERSONA_BLOCKLIST`` and
 * ``openclaw_distill_service.RUNTIME_ONLY_FILES``.
 */
const PERSONA_BLOCKLIST: ReadonlySet<string> = new Set([
  'HEARTBEAT.md',
  'BOOTSTRAP.md',
]);

export interface OssDistillPushResult {
  agentKey: string;
  vectorSha256: string | null;
  skillManifestSha256: string | null;
  personaManifestSha256: string | null;
  rawUploaded: number;
  rawSkipped: number;
  rawDeleted: number;
  skillsUploaded: number;
  personaUploaded: number;
  personaSkipped: number;
  durationMs: number;
}

export class DistillPushService {
  /**
   * Per-machine cache of the SSH user's ``$HOME``. We hit this from
   * every step that needs to expand ``~`` into an absolute path that
   * SFTP / ``downloadFilesBulk`` will accept (those APIs strictly
   * require leading ``/``).
   */
  private readonly homeCache = new Map<string, string>();

  constructor(
    private readonly pool: SSHPool,
    private readonly fileTransfer: FileTransfer,
    private readonly machineRepo: MachineRepository,
    private readonly agentRepo: AgentRepository,
  ) {}

  /**
   * Resolve the SSH user's actual ``$HOME`` directory once per
   * connection and cache it. Uses ``printf`` so we don't have to worry
   * about a trailing newline (``echo`` always adds one).
   */
  private async resolveRemoteHome(info: SSHConnectionInfo): Promise<string> {
    const cached = this.homeCache.get(info.machineId);
    if (cached) return cached;
    const res = await this.pool.executeCommand(
      info,
      'printf %s "$HOME"',
      { timeoutMs: 5_000 },
    );
    const home = res.stdout.trim();
    if (!home || !home.startsWith('/')) {
      throw new Error(`could not resolve $HOME on ${info.machineId}: got ${JSON.stringify(home)}`);
    }
    this.homeCache.set(info.machineId, home);
    return home;
  }

  /**
   * Expand a leading ``~`` to the SSH user's real ``$HOME`` so the
   * resulting path is acceptable to SFTP / ``downloadFilesBulk``.
   * Paths that already start with ``/`` pass through unchanged.
   */
  private async expandTilde(info: SSHConnectionInfo, p: string): Promise<string> {
    if (!p.startsWith('~')) return p;
    const home = await this.resolveRemoteHome(info);
    // Handle both `~/foo` and the bare `~` cases.
    return p === '~' ? home : home + p.slice(1);
  }

  /**
   * Run the OSS-direct push for one agent. Returns stats; mutates only
   * OSS + the platform Hub row (via webhook) + the agent row's OSS-sync
   * state columns (so the status API / UI badges stay accurate without
   * having to scrape pino logs).
   */
  async pushAgent(machineId: string, agentDbId: string): Promise<OssDistillPushResult> {
    const startedAt = Date.now();

    const machine = await this.machineRepo.findById(machineId);
    if (!machine) {
      throw new Error(`machine not found: ${machineId}`);
    }
    const agent = await this.agentRepo.findById(agentDbId);
    if (!agent || agent.machineId !== machineId) {
      throw new Error(`agent ${agentDbId} not found on machine ${machineId}`);
    }

    const oss = OssClient.fromEnv();
    if (!oss) {
      throw new Error(
        'OSS not configured (ALIYUN_OSS_* env vars). Distill push requires OSS credentials.',
      );
    }

    const machineAlias = (machine.alias ?? '').trim();
    const agentKey = slugifyAgentKey(machine.id, agent.agentId, machineAlias);
    log.info({ machineId, agentId: agent.agentId, agentKey }, 'starting distill push');

    const sshInfo: SSHConnectionInfo = {
      machineId: machine.id,
      host: machine.tailscaleHostname,
      username: machine.sshUser,
      port: machine.sshPort,
      password: machine.sshPassword ?? undefined,
    };

    // Wrap the actual pipeline so we can record both success AND failure
    // on the agent row. Without the failure branch a once-stuck agent
    // would just look "stale" forever in the UI; with it, ops can see
    // *why* it's stuck (the truncated error message) at a glance.
    try {
      const result = await this.runPushPipeline({
        machine,
        machineAlias,
        agent,
        agentKey,
        sshInfo,
        oss,
        startedAt,
      });
      await this.agentRepo
        .recordOssSync(agent.id, {
          status: 'ok',
          syncedAt: new Date(),
          vectorSha: result.vectorSha256,
          durationMs: result.durationMs,
        })
        .catch((err) =>
          // Stamping the row is best-effort: a transient DB blip should
          // NOT mask a successful OSS push, and the next push will
          // overwrite the stale row anyway.
          log.warn(
            { agentKey, err: (err as Error).message },
            'recordOssSync(ok) failed; UI freshness will lag until next push',
          ),
        );
      return result;
    } catch (err) {
      const message = (err as Error).message ?? String(err);
      await this.agentRepo
        .recordOssSync(agent.id, {
          status: 'failed',
          syncedAt: new Date(),
          error: message,
          durationMs: Date.now() - startedAt,
        })
        .catch((dbErr) =>
          log.warn(
            { agentKey, err: (dbErr as Error).message },
            'recordOssSync(failed) failed; UI will not surface this failure',
          ),
        );
      throw err;
    }
  }

  /**
   * The actual push pipeline. Split out from ``pushAgent`` so the
   * try/catch wrapper above can record the outcome on the agent row
   * without obscuring the steps. Same return shape as before.
   */
  private async runPushPipeline(args: {
    machine: NonNullable<Awaited<ReturnType<MachineRepository['findById']>>>;
    machineAlias: string;
    agent: NonNullable<Awaited<ReturnType<AgentRepository['findById']>>>;
    agentKey: string;
    sshInfo: SSHConnectionInfo;
    oss: OssClient;
    startedAt: number;
  }): Promise<OssDistillPushResult> {
    const { machine, machineAlias, agent, agentKey, sshInfo, oss, startedAt } = args;

    // --- step 1.5: incremental reindex on remote ---
    // Without this, ``snapshotRemoteSqlite`` below would freeze the current
    // (potentially stale) index — so any memory file written since the last
    // ``openclaw memory index`` would ship its raw markdown in step 4 but
    // be absent from the vector/FTS5 tables in step 6. mini-claw's
    // ``search_memory`` would silently fail to surface "today's notes".
    // We default to incremental (no ``--force``) so the cost is ~6s when
    // nothing changed; embedding cost is paid only for genuinely new files.
    await this.ensureRemoteIndexFresh(sshInfo, agent.agentId);

    // --- step 2: VACUUM INTO snapshot on remote ---
    const snapshotInfo = await this.snapshotRemoteSqlite(sshInfo, agent.agentId);

    // --- step 4: raw memory diff + upload ---
    // We scan the filesystem under ``<workspacePath>/memory/`` plus the
    // workspace-root ``MEMORY.md``/``memory.md`` directly via SSH. This
    // mirrors what clawconsole's discovery / sync does and is robust to
    // the bot's index sqlite being empty or stale (which it commonly is
    // for fresh / never-indexed agents — the snapshot DB has zero rows
    // in ``files`` for such bots, so reading the index would silently
    // upload nothing).
    const rawFiles = await this.scanRawMemoryFiles(
      sshInfo,
      machine.openclawHome,
      agent.workspacePath ?? `workspace-${agent.agentId}`,
    );

    const rawStats = await this.uploadRawMemory(
      oss,
      sshInfo,
      agentKey,
      agent.workspacePath ?? `workspace-${agent.agentId}`,
      rawFiles,
      machine.openclawHome,
    );

    // --- step 5: persona folder ---
    // SOUL/USER/IDENTITY/AGENTS/TOOLS live at the workspace root on the
    // openclaw machine. We SSH-read them fresh (same connection pool used
    // by raw memory) so this step does NOT depend on clawconsole's local
    // DB cache being warm. HEARTBEAT/BOOTSTRAP are blocklisted.
    const personaStats = await this.uploadPersonaFolder(
      oss,
      sshInfo,
      agentKey,
      agent.workspacePath ?? `workspace-${agent.agentId}`,
      machine.openclawHome,
    );

    // --- step 6: skill folders ---
    const { uploadedCount, manifestSha } = await this.uploadSkillFolders(
      oss,
      sshInfo,
      agent.workspacePath ?? `workspace-${agent.agentId}`,
      agentKey,
      machine.openclawHome,
    );

    // --- step 7: vector sqlite + meta ---
    const vectorMeta = await this.uploadVectorSqlite(
      oss,
      sshInfo,
      agentKey,
      snapshotInfo,
      machine.alias ?? '',
      agent.agentId,
    );

    // --- step 8: webhook → platform ---
    // Best-effort: at this point every OSS asset (raw memory, persona,
    // skills, vector sqlite + meta) has already landed on OSS. The webhook
    // only nudges mini-claw to invalidate its in-process cache earlier than
    // its own polling interval. If the webhook fails (auth misconfig, edge
    // proxy stripping headers, transient 5xx, …) the next platform poll
    // still picks up the new SHA from OSS, so we must NOT mark the agent
    // as failed and roll back the success counters in the daily backup.
    try {
      await this.notifyPlatform({
        agentKey,
        sourceMachineId: machine.id,
        sourceMachineAlias: machineAlias,
        sourceAgentId: agent.agentId,
        vectorMeta,
        skillManifestSha256: manifestSha,
        personaManifestSha256: personaStats.manifestSha,
      });
    } catch (err) {
      log.warn(
        {
          agentKey,
          err: (err as Error).message,
        },
        'mini-claw sync-completed webhook failed; OSS data is already up to date — platform will pick it up on next poll',
      );
    }

    // Best-effort cleanup of the remote snapshot file.
    await this.cleanupRemoteSnapshot(sshInfo, snapshotInfo.remoteSnapshotPath)
      .catch((err) =>
        log.warn({ err: (err as Error).message, agentKey },
          'remote snapshot cleanup failed'),
      );

    return {
      agentKey,
      // ``vectorMeta`` is typed as Record<string, unknown> (it's the JSON
      // sidecar we wrote to OSS), so narrow the sha256 here rather than
      // leaking ``unknown`` into the result shape.
      vectorSha256: typeof vectorMeta.sha256 === 'string' ? vectorMeta.sha256 : null,
      skillManifestSha256: manifestSha,
      personaManifestSha256: personaStats.manifestSha,
      rawUploaded: rawStats.uploaded,
      rawSkipped: rawStats.skipped,
      rawDeleted: rawStats.deleted,
      skillsUploaded: uploadedCount,
      personaUploaded: personaStats.uploaded,
      personaSkipped: personaStats.skipped,
      durationMs: Date.now() - startedAt,
    };
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  /**
   * Run ``openclaw memory index --agent <agentId>`` on the bot host so the
   * vector/FTS5 tables include every memory file written since the last
   * index run (typically: "today's notes").
   *
   * Why this exists
   * ---------------
   * ``snapshotRemoteSqlite`` is just ``VACUUM INTO`` — it copies whatever
   * index state the file currently has. If a user added 5 memory entries
   * today but nobody triggered an index, those 5 entries are present in
   * the filesystem (``workspace-<id>/memory/*.md``) and therefore will
   * be SFTP-uploaded by ``scanRawMemoryFiles`` / ``uploadRawMemory``,
   * but their *chunks* (with embeddings + bm25 stats) are NOT in
   * ``chunks_vec`` / ``chunks_fts``. mini-claw's ``search_memory`` would
   * happily report "no hit" for "today" — exactly the regression we
   * burned 2026-05-13 chasing.
   *
   * Failure mode
   * ------------
   * Best-effort: a transient OpenAI rate-limit, network blip, or even a
   * missing OPENAI_API_KEY on the bot host should NOT abort the entire
   * push. We log a warning and continue — the snapshot will still ship
   * the previous (stale) index, raw memory files still upload fresh, and
   * the next push will retry indexing. Aborting here would block every
   * downstream step (persona, skills, raw memory diff) for a problem
   * that's specific to the vector branch.
   *
   * PATH note
   * ---------
   * ``client.exec`` from ssh2 spawns a non-interactive shell that does
   * NOT source ``~/.bash_profile`` / ``~/.zshrc``, so ``openclaw``
   * (installed via Homebrew at ``/opt/homebrew/bin``) is not on PATH.
   * ``bash -lc`` forces a login shell which reads ``/etc/profile`` —
   * which ``path_helper`` populates from ``/etc/paths.d/`` and includes
   * the Homebrew prefix on both Intel and Apple Silicon Macs.
   */
  private async ensureRemoteIndexFresh(
    info: SSHConnectionInfo,
    agentId: string,
  ): Promise<void> {
    const safeAgent = agentId.replace(/[^a-zA-Z0-9_-]/g, '_');
    // ``openclaw memory index`` (without ``--force``) is incremental:
    // it skips files whose mtime hasn't changed since the last run, so
    // a no-op call is ~6s on Apple Silicon. The 5 min timeout covers a
    // realistic worst case of ~200 brand-new files needing embedding.
    const cmd = `bash -lc 'openclaw memory index --agent ${safeAgent}'`;
    const startedAt = Date.now();
    try {
      const res = await this.pool.executeCommand(info, cmd, { timeoutMs: 300_000 });
      const elapsedMs = Date.now() - startedAt;
      if (res.exitCode !== 0) {
        log.warn(
          {
            agentId,
            exitCode: res.exitCode,
            stderr: res.stderr.slice(-400),
            stdout: res.stdout.slice(-200),
            elapsedMs,
          },
          'remote memory index failed; continuing with potentially stale snapshot',
        );
        return;
      }
      log.info(
        { agentId, elapsedMs, stdoutTail: res.stdout.trim().split('\n').slice(-2).join(' | ') },
        'remote memory index complete',
      );
    } catch (err) {
      log.warn(
        {
          agentId,
          err: (err as Error).message,
          elapsedMs: Date.now() - startedAt,
        },
        'remote memory index threw; continuing with potentially stale snapshot',
      );
    }
  }

  private async snapshotRemoteSqlite(
    info: SSHConnectionInfo,
    agentId: string,
  ): Promise<{ remoteSnapshotPath: string; remoteSourcePath: string }> {
    // openclaw uses ~/.openclaw/memory/<agentId>.sqlite (sqlite-vec + FTS5).
    // We do: PRAGMA wal_checkpoint(TRUNCATE); VACUUM INTO <snapshot>;
    // We must substitute $HOME in the shell, then pass absolute paths
    // (sqlite3's single-quoted SQL string literal does not expand ~).
    const safeAgent = agentId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const remoteSourcePath = `$HOME/.openclaw/memory/${safeAgent}.sqlite`;
    const remoteSnapshotDir = `$HOME/.openclaw/.distill-snapshots`;
    const remoteSnapshotPath = `${remoteSnapshotDir}/${safeAgent}.sqlite`;

    // Use a heredoc-style command so the shell expands $HOME before
    // sqlite3 sees the literal path.
    const cmd =
      `set -e; ` +
      `mkdir -p "${remoteSnapshotDir}"; ` +
      `rm -f "${remoteSnapshotPath}"; ` +
      `SRC="${remoteSourcePath}"; SNAP="${remoteSnapshotPath}"; ` +
      `sqlite3 "$SRC" "PRAGMA wal_checkpoint(TRUNCATE); VACUUM INTO '$SNAP';"`;

    const res = await this.pool.executeCommand(info, cmd, { timeoutMs: 120_000 });
    if (res.exitCode !== 0) {
      throw new Error(
        `remote sqlite snapshot failed (exit=${res.exitCode}): ${res.stderr.slice(0, 400)}`,
      );
    }
    // Return ~-form for downstream callers; sftpDownloadBinary expands.
    return {
      remoteSnapshotPath: `~/.openclaw/.distill-snapshots/${safeAgent}.sqlite`,
      remoteSourcePath: `~/.openclaw/memory/${safeAgent}.sqlite`,
    };
  }

  private async cleanupRemoteSnapshot(
    info: SSHConnectionInfo,
    remotePath: string,
  ): Promise<void> {
    const target = remotePath.replace(/^~/, '$HOME');
    await this.pool.executeCommand(info, `rm -f "${target}"`, { timeoutMs: 10_000 });
  }

  /** Read the `files` table from a sqlite file via remote `sqlite3` CLI. */
  /**
   * Scan the agent's workspace directory for raw memory files via SSH.
   *
   * We list:
   *   - ``<workspaceRoot>/memory/**``  (recursive — only ``*.md``)
   *   - ``<workspaceRoot>/MEMORY.md``  (canonical root memory file)
   *   - ``<workspaceRoot>/memory.md``  (lowercase alias seen in some bots)
   *
   * Paths returned are RELATIVE to the workspace root (the same shape
   * the openclaw ``files`` table stores, so downstream upload code can
   * stay agnostic to the source).
   *
   * Why not use the snapshot sqlite's ``files`` table?
   * For a freshly distilled bot the bot may never have run a reindex —
   * the index is empty, so the ``files`` table has zero rows and we'd
   * upload nothing despite there being 250+ ``.md`` files on disk.
   * Filesystem scan is the source of truth.
   */
  private async scanRawMemoryFiles(
    info: SSHConnectionInfo,
    openclawHome: string,
    workspacePath: string,
  ): Promise<Array<{ path: string; hash: string; size: number }>> {
    const expandedHome = await this.expandTilde(info, openclawHome);
    const workspaceRoot =
      `${expandedHome.replace(/\/+$/, '')}/` +
      `${workspacePath.replace(/^\/+|\/+$/g, '')}`;

    // `find … -printf "%P\\t%s"` would be ideal but isn't portable
    // across macOS. We do two passes: list paths, then read sizes via
    // `wc -c` indirectly through `stat -c`. To stay POSIX-portable we
    // emit `<path>\t<size>` ourselves using a small shell loop.
    //
    // We deliberately exclude ``identity/``, ``browser/`` and other
    // openclaw-runtime folders (mirrors ``isExcludedFromSync`` in
    // clawconsole). Sizes are best-effort; if ``stat`` fails we emit 0
    // and let the upload step decide.
    const memDir = `${workspaceRoot}/memory`;
    const rootMd = `${workspaceRoot}/MEMORY.md`;
    const rootLower = `${workspaceRoot}/memory.md`;
    const cmd =
      `set -u; ` +
      `if [ -d "${memDir}" ]; then ` +
      `  find "${memDir}" -type f -name '*.md' -print0 2>/dev/null | ` +
      `    xargs -0 -I{} sh -c 'printf "%s\\t%s\\n" "$1" "$(wc -c <"$1" 2>/dev/null || echo 0)"' _ {} ; ` +
      `fi; ` +
      `for f in "${rootMd}" "${rootLower}"; do ` +
      `  if [ -f "$f" ]; then printf "%s\\t%s\\n" "$f" "$(wc -c <"$f" 2>/dev/null || echo 0)"; fi; ` +
      `done`;

    const { stdout } = await this.pool.executeCommand(info, cmd, { timeoutMs: 30_000 });
    const out: Array<{ path: string; hash: string; size: number }> = [];
    const prefix = `${workspaceRoot}/`;
    for (const line of stdout.split('\n')) {
      const trimmed = line.replace(/\r$/, '');
      if (!trimmed) continue;
      const tab = trimmed.lastIndexOf('\t');
      if (tab <= 0) continue;
      const abs = trimmed.slice(0, tab);
      const sizeStr = trimmed.slice(tab + 1);
      // Path stored in the files table is workspace-relative; the
      // uploader resolves it back to ``<openclawHome>/<workspace>/<rel>``
      // via ``resolveRemoteAbs``. Strip the workspace root prefix so
      // that round-trip works regardless of which $HOME we expanded.
      const rel = abs.startsWith(prefix) ? abs.slice(prefix.length) : abs;
      out.push({
        path: rel,
        hash: '', // computed below at upload time; first-time push has no diff base
        size: Number(sizeStr) || 0,
      });
    }
    log.info(
      { workspaceRoot, count: out.length },
      'scanned raw memory files from filesystem',
    );
    return out;
  }

  private async uploadRawMemory(
    oss: OssClient,
    info: SSHConnectionInfo,
    agentKey: string,
    workspacePath: string,
    rawFiles: Array<{ path: string; hash: string; size: number }>,
    openclawHome: string,
  ): Promise<{ uploaded: number; skipped: number; deleted: number }> {
    // Existing OSS keys to compute deletions (recursive — raw has subdirs).
    const existingPrefix = `${agentMemoryRawPrefix(agentKey)}`;
    const existingKeys = new Set<string>();
    try {
      const keys = await oss.listAllKeys(existingPrefix);
      for (const k of keys) existingKeys.add(k);
    } catch (err) {
      log.warn({ err: (err as Error).message }, 'list existing raw keys failed (will overwrite)');
    }

    let uploaded = 0;
    let skipped = 0;
    const seenFullKeys = new Set<string>();

    // Diff: per-file hash comparison against existing OSS object metadata.
    // For first-time pushes we don't have prior hashes; we just upload all.
    // (A future optimization can stamp x-oss-meta-sha256 on PUT to skip
    //  re-upload when the hash matches.)
    for (const entry of rawFiles) {
      const rel = entry.path.replace(/^\/+/, '');
      const ossKey = agentMemoryRawKey(agentKey, rel);
      const fullKey = oss.fullKey(ossKey);
      seenFullKeys.add(fullKey);

      // Read remote file via base64 stream — small overhead but resilient.
      const remoteAbs = await this.resolveRemoteAbs(
        info,
        openclawHome,
        workspacePath,
        rel,
      );
      const content = await this.fileTransfer
        .downloadFilesBulk(info, [remoteAbs])
        .then((res) => res[0]);
      if (content === null) {
        log.warn({ agentKey, rel }, 'raw file missing on remote; skipping');
        continue;
      }
      const body = Buffer.from(content, 'utf8');
      const ctype = rel.toLowerCase().endsWith('.md')
        ? 'text/markdown; charset=utf-8'
        : 'application/octet-stream';
      await oss.putBuffer(ossKey, body, ctype);
      uploaded += 1;
    }

    let deleted = 0;
    for (const key of existingKeys) {
      if (seenFullKeys.has(key)) continue;
      const rel = oss.toRelativeKey(key);
      await oss.delete(rel).catch((err) =>
        log.warn({ err: (err as Error).message, key }, 'stale raw delete failed'),
      );
      deleted += 1;
    }

    return { uploaded, skipped, deleted };
  }

  /**
   * Push persona files (SOUL/USER/IDENTITY/AGENTS/TOOLS) to
   * ``scopes/agent/<agent_key>/persona/`` and write a manifest.
   *
   * Strategy
   * --------
   *
   * - SSH-read fresh content for each candidate file from the openclaw
   *   workspace root; missing files are silently skipped (a bot may
   *   intentionally not ship a USER.md, etc.).
   * - HEARTBEAT.md / BOOTSTRAP.md are blocklisted at write time so they
   *   can never reach OSS — we don't even attempt to read them.
   * - Per-file SHA + manifest SHA are computed identically to the
   *   platform's ``agent_persona_oss_service`` so the cross-language
   *   round-trip stays bit-for-bit stable.
   * - Files present on OSS but absent now are deleted so the folder
   *   mirrors the workspace exactly (mirrors the platform service).
   * - Each file's SHA is diffed against the previous manifest to skip
   *   re-uploads when the bytes haven't changed.
   *
   * Returns the persona manifest SHA (or null when nothing was pushed)
   * + counters for UI surfacing.
   */
  private async uploadPersonaFolder(
    oss: OssClient,
    info: SSHConnectionInfo,
    agentKey: string,
    workspacePath: string,
    openclawHome: string,
  ): Promise<{ manifestSha: string | null; uploaded: number; skipped: number; deleted: number }> {
    // Build the candidate set, filtering out the blocklist defensively
    // (the constant already excludes them; this is belt-and-braces).
    const candidates = PERSONA_FILES.filter((name) => !PERSONA_BLOCKLIST.has(name));

    // Workspace root is <openclawHome>/<workspacePath>; persona files
    // live directly inside it (NOT in a sub-folder). ``openclawHome``
    // is stored as ``~/.openclaw`` in the machines table — we have to
    // expand ``~`` to an absolute ``$HOME`` BEFORE handing the paths
    // to ``downloadFilesBulk``, which strictly requires a leading ``/``
    // (see ``file-transfer.ts:downloadFilesBulk``).
    const expandedHome = await this.expandTilde(info, openclawHome);
    const workspaceRoot =
      `${expandedHome.replace(/\/+$/, '')}/${workspacePath.replace(/^\/+|\/+$/g, '')}`;
    const remoteAbs = candidates.map((name) => `${workspaceRoot}/${name}`);

    // Bulk-read; null entries == file does not exist on the remote.
    const contents = await this.fileTransfer.downloadFilesBulk(info, remoteAbs);

    const presentFiles: Array<{ rel: string; body: Buffer; sha256: string }> = [];
    for (let i = 0; i < candidates.length; i++) {
      const txt = contents[i];
      if (txt === null) continue;
      const body = Buffer.from(txt, 'utf8');
      presentFiles.push({
        rel: candidates[i],
        body,
        sha256: sha256OfBuffer(body),
      });
    }

    // If the bot has no persona files at all, skip the whole step — no
    // empty manifests, no stale-folder deletion. Reconcile will see this
    // as ``missing-oss`` on the platform side and tell admin to look.
    if (presentFiles.length === 0) {
      log.warn({ agentKey }, 'no persona files found on remote; skipping persona push');
      return { manifestSha: null, uploaded: 0, skipped: 0, deleted: 0 };
    }

    // Build entries (sorted by path so manifest sha is deterministic).
    const now = nowIso();
    const entries = presentFiles
      .map((f) => ({
        path: f.rel,
        size: f.body.length,
        sha256: f.sha256,
        updated_at: now,
      }))
      .sort((a, b) => a.path.localeCompare(b.path));

    // Manifest SHA: identical contract to ``_manifest_dict`` in
    // ``agent_persona_oss_service`` — sha256(JSON.stringify(entries,
    // sort_keys=true)). Node's JSON.stringify sorts object keys by
    // insertion order, so we explicitly order the fields the same as
    // the Python dataclass `_FileEntry.to_dict()` to keep bytes equal.
    const canonicalEntries = entries.map((e) => ({
      path: e.path,
      size: e.size,
      sha256: e.sha256,
      updated_at: e.updated_at,
    }));
    const sig = JSON.stringify(canonicalEntries);
    const manifestSha = sha256OfBuffer(Buffer.from(sig, 'utf8'));

    // Diff against the existing manifest to skip unchanged uploads.
    const existing = await oss
      .getString(agentPersonaManifestKey(agentKey))
      .catch(() => null);
    const existingByPath = new Map<string, string>();
    if (existing) {
      try {
        const parsed = JSON.parse(existing) as { files?: Array<{ path: string; sha256: string }> };
        for (const f of parsed.files ?? []) {
          if (f.path && f.sha256) existingByPath.set(f.path, f.sha256);
        }
      } catch {
        // Corrupt manifest — just rewrite everything.
      }
    }

    let uploaded = 0;
    let skipped = 0;
    for (const f of presentFiles) {
      const prior = existingByPath.get(f.rel);
      if (prior === f.sha256) {
        skipped += 1;
        continue;
      }
      await oss.putBuffer(
        agentPersonaFileKey(agentKey, f.rel),
        f.body,
        'text/markdown; charset=utf-8',
      );
      uploaded += 1;
    }

    // Delete stale files (present on OSS but absent now). We only sweep
    // the canonical persona names + manifest, never anything else, so a
    // stray non-persona file under persona/ won't be touched by accident.
    let deleted = 0;
    const presentSet = new Set(presentFiles.map((f) => f.rel));
    for (const name of existingByPath.keys()) {
      if (presentSet.has(name)) continue;
      if (PERSONA_BLOCKLIST.has(name)) continue;  // shouldn't be on OSS anyway
      await oss
        .delete(agentPersonaFileKey(agentKey, name))
        .catch((err) =>
          log.warn({ err: (err as Error).message, agentKey, name },
            'stale persona delete failed'),
        );
      deleted += 1;
    }

    // Manifest is rewritten unconditionally so its updated_at stamp
    // reflects this push even when every file was a no-op.
    const manifest = {
      agent_key: agentKey,
      files: canonicalEntries,
      manifest_sha256: manifestSha,
      updated_at: nowIso(),
    };
    await oss.putString(
      agentPersonaManifestKey(agentKey),
      JSON.stringify(manifest, null, 2),
      'application/json; charset=utf-8',
    );

    log.info(
      {
        agentKey,
        uploaded,
        skipped,
        deleted,
        manifestSha: manifestSha.slice(0, 12),
        prefix: agentPersonaPrefix(agentKey),
      },
      'persona pushed',
    );

    return { manifestSha, uploaded, skipped, deleted };
  }

  private async resolveRemoteAbs(
    info: SSHConnectionInfo,
    openclawHome: string,
    workspacePath: string,
    relativePath: string,
  ): Promise<string> {
    // The path stored in openclaw's sqlite ``files`` table is relative
    // to the agent's workspace dir. Resolve to an absolute path under
    // the remote home.
    //
    // ``openclawHome`` is stored in the DB as ``~/.openclaw`` (see
    // ``machine.repository.ts`` default). We must expand the leading
    // tilde to the SSH user's real ``$HOME`` BEFORE returning, because
    // SFTP / ``downloadFilesBulk`` reject any non-absolute path. The
    // previous implementation went through ``echo "${candidate}"``
    // which does NOT expand ``~`` inside double quotes — silently broken
    // for the default machine config. Use the same ``printf $HOME``
    // helper as ``uploadPersonaFolder`` (cached per machine).
    const expandedHome = await this.expandTilde(info, openclawHome);
    return (
      `${expandedHome.replace(/\/+$/, '')}/` +
      `${workspacePath.replace(/^\/+|\/+$/g, '')}/` +
      `${relativePath.replace(/^\/+/, '')}`
    );
  }

  private async uploadSkillFolders(
    oss: OssClient,
    info: SSHConnectionInfo,
    workspacePath: string,
    agentKey: string,
    openclawHome: string,
  ): Promise<{ uploadedCount: number; manifestSha: string | null }> {
    // openclaw resolves skills from a layered set of locations at
    // runtime (see openclaw docs /faq §"managed overrides"):
    //
    //   1. ``<workspace>/skills/`` — per-agent, highest precedence
    //   2. ``~/.openclaw/skills/`` — machine-global, shared across agents
    //   3. bundled (inside the openclaw binary; not on disk)
    //
    // For the OSS push we union (1) and (2) since both are what the bot
    // *actually loads* at runtime; per-agent wins on key collision (the
    // same precedence openclaw uses). Bundled skills are out of scope
    // (we can't read them from the FS and the platform ships its own
    // bundled set anyway).
    //
    // NOTE: a previous version of this code looked under
    // ``<openclawHome>/agents/<agentId>/.claude/skills`` which is the
    // Claude Code convention, *not* openclaw's. ``openclawHome`` is
    // stored as ``~/.openclaw`` by default; bash does NOT expand ``~``
    // inside single quotes (e.g. ``[ -d '~/x' ]`` returns false even
    // when the dir exists), so we expand it via cached ``$HOME`` before
    // composing any shell commands or SFTP paths.
    const expandedHome = await this.expandTilde(info, openclawHome);
    const perAgentRoot =
      `${expandedHome.replace(/\/+$/, '')}/` +
      `${workspacePath.replace(/^\/+|\/+$/g, '')}/skills`;
    const globalRoot = `${expandedHome.replace(/\/+$/, '')}/skills`;

    // Merge skill keys from both roots. ``listSkillDirs`` returns ``[]``
    // when the root doesn't exist so we never throw on missing layers.
    const perAgentKeys = await this.listSkillDirs(info, perAgentRoot);
    const globalKeys = await this.listSkillDirs(info, globalRoot);
    log.info(
      {
        agentKey,
        perAgentRoot,
        perAgentCount: perAgentKeys.length,
        globalRoot,
        globalCount: globalKeys.length,
      },
      'discovered skill folders',
    );

    // Build the union with per-agent winning on collision (matches the
    // openclaw runtime precedence above).
    const sources = new Map<string, { remoteDir: string; scope: 'agent' | 'global' }>();
    for (const k of globalKeys) {
      sources.set(k, { remoteDir: `${globalRoot}/${k}`, scope: 'global' });
    }
    for (const k of perAgentKeys) {
      sources.set(k, { remoteDir: `${perAgentRoot}/${k}`, scope: 'agent' });
    }

    let uploadedCount = 0;
    const skillManifestShas: string[] = [];

    for (const [skillKey, { remoteDir, scope }] of sources) {
      const findCmd = `find '${remoteDir}' -type f | sort`;
      const findRes = await this.pool.executeCommand(info, findCmd, { timeoutMs: 20_000 });
      const remotePaths = findRes.stdout
        .split('\n')
        .map((p) => p.trim())
        .filter(Boolean);
      if (!remotePaths.length) continue;

      // Pull every file in one bulk download.
      const contents = await this.fileTransfer.downloadFilesBulk(info, remotePaths);
      const files: Array<{ rel: string; body: Buffer }> = [];
      for (let i = 0; i < remotePaths.length; i++) {
        const txt = contents[i];
        if (txt === null) continue;
        const rel = remotePaths[i].slice(remoteDir.length + 1);
        files.push({ rel, body: Buffer.from(txt, 'utf8') });
      }
      // A skill folder without a SKILL.md is not a valid openclaw skill
      // (see ``discovered_skills`` rule); skip it so we don't pollute
      // the agent's OSS scope with empty manifests.
      if (!files.some((f) => f.rel === 'SKILL.md')) continue;

      // Build entries + manifest sha matching the Python service.
      const entries = files
        .map((f) => ({
          path: f.rel,
          size: f.body.length,
          sha256: sha256OfBuffer(f.body),
          updated_at: nowIso(),
        }))
        .sort((a, b) => a.path.localeCompare(b.path));
      const sig = JSON.stringify(entries);
      const manifestSha = sha256OfBuffer(Buffer.from(sig, 'utf8'));

      // Parse SKILL.md frontmatter minimally so the manifest carries
      // user-facing name/description/tags. We just look for `name:` and
      // `description:` flat lines — anything richer is left to the
      // platform-side `read_skill_md`.
      let skillMdMeta: Record<string, unknown> = {};
      const skillMdEntry = files.find((f) => f.rel === 'SKILL.md');
      if (skillMdEntry) {
        skillMdMeta = parseFrontmatter(skillMdEntry.body.toString('utf8'));
      }

      const manifest = {
        agent_key: agentKey,
        skill_key: skillKey,
        // The agent loads this skill at runtime regardless of where it
        // came from; we record the source for traceability so a future
        // dedupe step can move shared skills into a machine-scope
        // namespace without losing provenance.
        owner_scope: scope,
        owner_key: agentKey,
        name: (skillMdMeta.name as string | undefined) ?? skillKey,
        description: (skillMdMeta.description as string | undefined) ?? '',
        tags: Array.isArray(skillMdMeta.tags) ? skillMdMeta.tags : [],
        files: entries,
        manifest_sha256: manifestSha,
        updated_at: nowIso(),
      };

      for (const f of files) {
        const ossKey = agentSkillFileKey(agentKey, skillKey, f.rel);
        const ctype = f.rel.endsWith('.md')
          ? 'text/markdown; charset=utf-8'
          : 'application/octet-stream';
        await oss.putBuffer(ossKey, f.body, ctype);
        uploadedCount += 1;
      }
      await oss.putString(
        agentSkillManifestKey(agentKey, skillKey),
        JSON.stringify(manifest, null, 2),
        'application/json; charset=utf-8',
      );
      skillManifestShas.push(manifestSha);
    }

    // Aggregate manifest sha covers the agent's whole skill set.
    const aggregate = skillManifestShas.length
      ? sha256OfBuffer(Buffer.from(skillManifestShas.sort().join(',')))
      : null;
    return { uploadedCount, manifestSha: aggregate };
  }

  /**
   * Shallow list of skill folder names under ``root`` on the remote.
   * Returns ``[]`` when ``root`` does not exist (so the caller can
   * union per-agent + global roots safely without checking first).
   */
  private async listSkillDirs(
    info: SSHConnectionInfo,
    root: string,
  ): Promise<string[]> {
    const lsCmd =
      `if [ -d '${root}' ]; then ls -1 '${root}'; else echo ''; fi`;
    const { stdout } = await this.pool.executeCommand(info, lsCmd, { timeoutMs: 10_000 });
    return stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  }

  private async uploadVectorSqlite(
    oss: OssClient,
    info: SSHConnectionInfo,
    agentKey: string,
    snapshot: { remoteSnapshotPath: string },
    machineAlias: string,
    sourceAgentId: string,
  ): Promise<Record<string, unknown>> {
    // SFTP-download the snapshot to a local temp file, then PUT to OSS.
    const localTmp = path.join(
      os.tmpdir(),
      `clawconsole-distill-${agentKey}-${Date.now()}.sqlite`,
    );

    // We can't use downloadFilesBulk because that uses base64+stdout (which
    // breaks for binary content > a few MB on slow links). Use SFTP
    // streaming directly through the file-transfer client.
    await this.sftpDownloadBinary(info, snapshot.remoteSnapshotPath, localTmp);

    const body = await fsp.readFile(localTmp);
    const sha = sha256OfBuffer(body);
    await oss.putBuffer(agentVectorSqliteKey(agentKey), body, 'application/octet-stream');

    const meta: Record<string, unknown> = {
      provider: SHARED_OPENCLAW_VECTOR_PROVIDER,
      model: SHARED_OPENCLAW_VECTOR_MODEL,
      dim: SHARED_OPENCLAW_VECTOR_DIM,
      sha256: sha,
      size: body.length,
      source_agent_id: sourceAgentId,
      source_machine: machineAlias,
      snapshot_at: nowIso(),
    };
    await oss.putString(
      agentVectorMetaKey(agentKey),
      JSON.stringify(meta, null, 2),
      'application/json; charset=utf-8',
    );

    await fsp.unlink(localTmp).catch(() => {});
    return meta;
  }

  /** SFTP binary download — handles files of arbitrary size. */
  private async sftpDownloadBinary(
    info: SSHConnectionInfo,
    remotePath: string,
    localPath: string,
  ): Promise<void> {
    const client = await this.pool.getConnection(info);
    try {
      // Expand `~` via $HOME on the remote so SFTP gets an absolute path.
      // (`ssh2`'s sftp doesn't tilde-expand and rejects `~/...`.)
      let resolved = remotePath;
      if (remotePath.startsWith('~')) {
        const homeRes = await this.pool.executeCommand(
          info,
          'printf %s "$HOME"',
          { timeoutMs: 5_000 },
        );
        const home = homeRes.stdout.trim();
        resolved = home ? remotePath.replace(/^~/, home) : remotePath;
      }

      await new Promise<void>((resolve, reject) => {
        client.sftp((err, sftp) => {
          if (err) {
            reject(err);
            return;
          }
          const ws = fs.createWriteStream(localPath);
          const rs = sftp.createReadStream(resolved);
          rs.on('error', (e: Error) => {
            sftp.end();
            reject(e);
          });
          ws.on('error', reject);
          ws.on('close', () => {
            sftp.end();
            resolve();
          });
          rs.pipe(ws);
        });
      });
    } finally {
      this.pool.releaseConnection(info.machineId, client);
    }
  }

  private async notifyPlatform(payload: {
    agentKey: string;
    sourceMachineId: string;
    sourceMachineAlias: string;
    sourceAgentId: string;
    vectorMeta: Record<string, unknown>;
    skillManifestSha256: string | null;
    personaManifestSha256: string | null;
  }): Promise<void> {
    if (!MINICLAW_BASE_URL || !MINICLAW_SERVICE_TOKEN) {
      log.warn(
        'MINICLAW_BASE_URL / MINICLAW_DISTILL_SERVICE_TOKEN missing — skipping webhook',
      );
      return;
    }
    const url = `${MINICLAW_BASE_URL}/api/v1/apps/agents-hub/openclaw/sync-completed`;
    // Lean webhook: pass SHAs only. The platform reads the actual content
    // back from OSS using the three manifest paths (persona / skills /
    // vector). When any SHA matches the cached value in the DB, that
    // section is a no-op refresh on the platform side.
    const body = JSON.stringify({
      agent_key: payload.agentKey,
      source_machine_id: payload.sourceMachineId,
      source_machine_alias: payload.sourceMachineAlias,
      source_agent_id: payload.sourceAgentId,
      vector_meta: payload.vectorMeta,
      skill_manifest_sha256: payload.skillManifestSha256,
      persona_manifest_sha256: payload.personaManifestSha256,
    });
    // Send the token via BOTH ``X-Service-Token`` (legacy / direct hits)
    // and ``Authorization: Bearer …`` (so edge proxies that strip custom
    // ``X-…`` headers don't block us). The platform accepts either; this
    // is belt-and-suspenders so the webhook keeps working across
    // ingress/proxy reconfigurations without a console redeploy.
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Service-Token': MINICLAW_SERVICE_TOKEN,
        Authorization: `Bearer ${MINICLAW_SERVICE_TOKEN}`,
      },
      body,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(
        `mini-claw sync-completed webhook ${res.status}: ${text.slice(0, 200)}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Minimal YAML frontmatter parser (flat key:value + tags list)
// ---------------------------------------------------------------------------
function parseFrontmatter(content: string): Record<string, unknown> {
  if (!content.startsWith('---')) return {};
  const lines = content.split('\n');
  if (lines.length < 2 || lines[0].trim() !== '---') return {};
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      end = i;
      break;
    }
  }
  if (end < 0) return {};
  const front = lines.slice(1, end);
  const out: Record<string, unknown> = {};
  for (let i = 0; i < front.length; i++) {
    const line = front[i];
    const m = /^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    const key = m[1];
    let val = m[2];
    if (val === '' || val === '|') {
      const block: string[] = [];
      while (i + 1 < front.length && /^\s+/.test(front[i + 1])) {
        block.push(front[i + 1].replace(/^\s+/, ''));
        i += 1;
      }
      out[key] = block.join('\n').trim();
      continue;
    }
    if (val.startsWith('[') && val.endsWith(']')) {
      out[key] = val
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim().replace(/^"|"$/g, ''))
        .filter(Boolean);
      continue;
    }
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

