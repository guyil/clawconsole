# ClawConsole — Sync Engine Design

> Version: 1.0 | Last Updated: 2026-03-06

## Table of Contents

1. [Overview](#1-overview)
2. [Sync Protocol: Pull-Before-Push](#2-sync-protocol-pull-before-push)
3. [Manifest Collection](#3-manifest-collection)
4. [Diff Engine](#4-diff-engine)
5. [Sync Mode Detection](#5-sync-mode-detection)
6. [Conflict Resolution](#6-conflict-resolution)
7. [File Transfer](#7-file-transfer)
8. [Post-Sync Verification](#8-post-sync-verification)
9. [Failure Handling & Retry](#9-failure-handling--retry)
10. [Batch Operations](#10-batch-operations)

---

## 1. Overview

The Sync Engine is the core component of ClawConsole. It maintains consistency between
the database (MySQL) and the remote file systems (`~/.openclaw/` on Tailscale nodes).

### Design Principles

- **Pull-before-push**: Always fetch latest remote state before pushing changes
- **Hash-based change detection**: Use SHA-256 to detect file changes (not timestamps)
- **Minimal transfer**: Only transfer changed files, never full directory trees
- **Classification-aware**: Different file types have different sync behaviors
- **Partial failure tolerant**: Record per-file status; retry only failed files
- **Auditable**: Every sync operation is logged with full detail

---

## 2. Sync Protocol: Pull-Before-Push

### Sequence

```
                  Console                         Remote Machine
                    │                                   │
  ┌─── Pull Phase ──┤                                   │
  │                 │── SSH: collect manifest ──────────►│
  │                 │◄──────────── manifest ─────────────│
  │                 │                                   │
  │                 │── Compare manifest vs DB          │
  │                 │                                   │
  │                 │── SSH: download changed files ───►│
  │                 │◄──────────── file contents ───────│
  │                 │                                   │
  │                 │── Update DB (content, hashes) ───►│ (MySQL)
  └─────────────────┤                                   │
                    │                                   │
  ┌─ User Editing ──┤                                   │
  │                 │   (user edits files in Console)   │
  └─────────────────┤                                   │
                    │                                   │
  ┌── Push Phase ───┤                                   │
  │                 │── Compute push set (dirty files)  │
  │                 │── Detect sync mode (hot/warm/cold)│
  │                 │                                   │
  │                 │── SSH: upload files ──────────────►│
  │                 │◄──────────── transfer result ─────│
  │                 │                                   │
  │                 │── SSH: verify hashes ─────────────►│
  │                 │◄──────────── verification ────────│
  │                 │                                   │
  │                 │── SSH: post-sync actions ─────────►│
  │                 │   (doctor, restart if needed)     │
  │                 │◄──────────── health status ───────│
  │                 │                                   │
  │                 │── Update DB (sync state, hashes) ─│
  └─────────────────┤                                   │
```

### When Pull-Before-Push Runs

| Trigger | Description |
|---------|-------------|
| User opens agent editor | Auto-pull agent's workspace files |
| User clicks "Sync" button | Full pull + push cycle |
| Background auto-pull job | Every 5 minutes, manifest-only check |
| Before any push operation | Mandatory — refuses to push without fresh pull |

### Staleness Check

Before pushing, verify the pull is recent enough:

```typescript
const PULL_STALENESS_THRESHOLD_MS = 30_000; // 30 seconds

function isPullFresh(lastPullAt: Date): boolean {
  return Date.now() - lastPullAt.getTime() < PULL_STALENESS_THRESHOLD_MS;
}
```

If the last pull is stale, automatically re-pull before pushing.

---

## 3. Manifest Collection

### What is a Manifest?

A manifest is a lightweight snapshot of the remote file system state:

```typescript
interface RemoteManifest {
  machineId: string;
  collectedAt: Date;
  files: ManifestEntry[];
}

interface ManifestEntry {
  relativePath: string;  // e.g., "workspace-pm/SOUL.md"
  hash: string;          // SHA-256
  size: number;          // bytes
  mtime: number;         // unix timestamp
}
```

### Collection Command

A single SSH command collects the manifest efficiently:

```bash
#!/bin/bash
# manifest-collect.sh — run on remote machine
cd "${OPENCLAW_HOME:-$HOME/.openclaw}"

find . -type f \
  ! -path './.git/*' \
  ! -path '*/node_modules/*' \
  ! -path './browser/*' \
  ! -path './canvas/*' \
  ! -path './completions/*' \
  ! -path './identity/*' \
  ! -path '*.sqlite' \
  ! -path '*.sqlite-wal' \
  ! -path '*.sqlite-shm' \
  -print0 | while IFS= read -r -d '' file; do
    hash=$(sha256sum "$file" | cut -d' ' -f1)
    stat_output=$(stat -c '%s %Y' "$file" 2>/dev/null || stat -f '%z %m' "$file" 2>/dev/null)
    size=$(echo "$stat_output" | cut -d' ' -f1)
    mtime=$(echo "$stat_output" | cut -d' ' -f2)
    echo "${file}|${hash}|${size}|${mtime}"
done
```

Output format: `./relative/path|sha256hash|size|mtime` (one line per file).

### Performance Optimization

- SQLite files (`.sqlite`, `.sqlite-wal`) are excluded — too large and binary
- `.git` directories excluded — managed by OpenClaw's own git
- `browser/`, `canvas/`, `completions/` excluded — system internal
- Results cached in Redis with 60-second TTL: `manifest:{machineId}`
- Typical manifest size: ~200 files, ~50KB of text

---

## 4. Diff Engine

### Inputs

```typescript
interface DiffInput {
  localFiles: Map<string, { contentHash: string; remotHash: string }>;  // from DB
  remoteManifest: ManifestEntry[];                                       // from SSH
}
```

### Outputs

```typescript
interface DiffResult {
  remoteNew: ManifestEntry[];       // exists on remote, not in DB
  remoteModified: ManifestEntry[];  // exists in both, remote hash != stored remote hash
  remoteDeleted: string[];          // exists in DB but not on remote
  localDirty: ManagedFile[];        // local_dirty = true in DB
  conflicts: ConflictEntry[];       // both local and remote changed
  unchanged: string[];              // no changes
}

interface ConflictEntry {
  relativePath: string;
  localHash: string;
  remoteHash: string;
  lastKnownRemoteHash: string;
}
```

### Diff Algorithm

```
For each file in remoteManifest:
  if not in DB:
    → remoteNew
  else if remote.hash != db.remote_hash:
    if db.local_dirty:
      → conflict (both sides changed)
    else:
      → remoteModified
  else:
    → unchanged

For each file in DB:
  if not in remoteManifest:
    → remoteDeleted (or was a console-managed file not yet pushed)
  if db.local_dirty and not in conflicts:
    → localDirty (ready to push)
```

---

## 5. Sync Mode Detection

After computing the push set (files to upload), detect the appropriate sync mode:

```typescript
function detectSyncMode(filesToPush: string[]): 'hot' | 'warm' | 'cold' {
  if (filesToPush.length === 0) return 'hot'; // no-op

  const HOT_PATTERNS = [
    /^workspace-[^/]+\/(SOUL|IDENTITY|USER|AGENTS|TOOLS|BOOTSTRAP|HEARTBEAT|README)\.md$/,
    /^workspace-[^/]+\/skills\/[^/]+\/SKILL\.md$/,
    /^skills\/[^/]+\/SKILL\.md$/,
    /^workspace-[^/]+\/config\/.*\.json$/,
  ];

  const WARM_TRIGGERS = [
    'openclaw.json',
    /^credentials\//,
    /^cron\/jobs\.json$/,
    /^hooks\//,
  ];

  // Check if any warm trigger files are in the push set
  const hasWarmTrigger = filesToPush.some(f =>
    WARM_TRIGGERS.some(t => typeof t === 'string' ? f === t : t.test(f))
  );

  if (hasWarmTrigger) return 'warm';

  // Check if all files match hot patterns
  const allHot = filesToPush.every(f =>
    HOT_PATTERNS.some(p => p.test(f))
  );

  return allHot ? 'hot' : 'warm';
}
```

### Implications by Mode

| Mode | File Transfer | Post-Sync |
|------|--------------|-----------|
| Hot | SCP individual files | No restart; files hot-reloaded by OpenClaw |
| Warm | rsync incremental | `systemctl --user restart openclaw` |
| Cold | rsync --delete + npm install | Full restart + `openclaw doctor --fix` |

---

## 6. Conflict Resolution

### When Conflicts Occur

A conflict exists when:
- `managed_files.local_dirty = true` (Console has unsaved edits)
- AND remote file hash differs from `managed_files.remote_hash` (remote changed since last pull)

### Resolution Strategies

```typescript
type ConflictStrategy = 'local_wins' | 'remote_wins' | 'user_decides';

function resolveConflictStrategy(relativePath: string, fileCategory: string): ConflictStrategy {
  // Runtime files: remote always wins
  if (fileCategory === 'runtime_observable') return 'remote_wins';

  // openclaw.json: Console is authority for config
  if (relativePath === 'openclaw.json') return 'local_wins';

  // Persona and skill files: user decides
  return 'user_decides';
}
```

### User-Decides Flow

1. API returns conflict list with both versions
2. Frontend shows side-by-side diff
3. User picks: "Keep Console version", "Use Remote version", or "Edit manually"
4. Selected version is saved to DB, then pushed

---

## 7. File Transfer

### Hot Sync: SCP Individual Files

```typescript
async function hotSyncFile(ssh: SSHConnection, localContent: string, remotePath: string): Promise<void> {
  const sftp = await ssh.requestSFTP();
  const fullPath = `${openclawHome}/${remotePath}`;
  await sftp.writeFile(fullPath, localContent, { mode: 0o644 });
}
```

### Warm Sync: rsync Incremental

```typescript
async function warmSync(machineId: string, localDir: string, excludes: string[]): Promise<void> {
  const machine = await machineRepo.findById(machineId);
  const excludeArgs = excludes.map(e => `--exclude='${e}'`).join(' ');
  
  const cmd = `rsync -avz --checksum ${excludeArgs} \
    -e "ssh -p ${machine.sshPort}" \
    ${localDir}/ ${machine.sshUser}@${machine.tailscaleHostname}:${machine.openclawHome}/`;
  
  await execShell(cmd);
}
```

### Default Excludes (warm/cold sync)

```typescript
const SYNC_EXCLUDES = [
  'memory/',              // Agent memory (runtime)
  '*.sqlite',             // SQLite memory files
  '*.sqlite-wal',
  '*.sqlite-shm',
  'agents/*/sessions/',   // Session data (runtime)
  'logs/',                // Log files (runtime)
  'identity/',            // Device identity (system)
  'devices/',             // Device pairing (runtime)
  'delivery-queue/',      // Message queue (runtime)
  'feishu/dedup/',        // Channel dedup (runtime)
  'subagents/',           // Sub-agent runs (runtime)
  'browser/',             // Browser data (system)
  'canvas/',              // Canvas UI (system)
  'completions/',         // Shell completions (system)
  '.git/',                // Git repos
  'update-check.json',    // Version check (system)
  '*.bak*',               // Backup files
];
```

### Credential Transfer: Stream Pipe (no temp file)

```typescript
async function syncCredential(ssh: SSHConnection, decryptedValue: string, targetPath: string): Promise<void> {
  const fullPath = `${openclawHome}/${targetPath}`;
  const cmd = `cat > '${fullPath}' && chmod 600 '${fullPath}'`;
  const stream = await ssh.exec(cmd);
  stream.stdin.write(decryptedValue);
  stream.stdin.end();
  await waitForExit(stream);
}
```

---

## 8. Post-Sync Verification

After file transfer, verify the deployment is healthy:

### Step 1: Hash Verification

```bash
# Verify pushed files arrived intact
ssh user@host 'cd ~/.openclaw && sha256sum workspace-pm/SOUL.md'
```

Compare against expected hash. If mismatch, mark file as failed.

### Step 2: Config Check (warm/cold only)

```bash
ssh user@host 'openclaw doctor --fix 2>&1'
```

Parse output for warnings/errors.

### Step 3: Gateway Restart (warm/cold only)

```bash
ssh user@host 'systemctl --user restart openclaw'
```

### Step 4: Health Check

```bash
ssh user@host 'systemctl --user is-active openclaw'
# Expected: "active"
```

Or via Gateway HTTP API (through Tailscale):

```bash
curl -s https://{hostname}.tailnet:18789/api/health
```

---

## 9. Failure Handling & Retry

### Per-File Status Tracking

Every file in a sync operation has its own status:

```typescript
type FileTransferStatus = 'pending' | 'completed' | 'failed' | 'skipped';
```

### Operation Status Rules

| Condition | Operation Status |
|-----------|-----------------|
| All files completed | `completed` |
| Some files failed, some completed | `partial_failure` |
| All files failed or critical error | `failed` |

### Retry Strategy

- **Automatic retry**: BullMQ job runs every 2 minutes, picks up `partial_failure` operations
- **Max retries**: 3 per operation
- **Retry scope**: Only re-transfer files with `status = 'failed'`
- **Backoff**: 2 min → 4 min → 8 min (exponential)
- **Manual retry**: User can trigger retry from the sync history UI

### Error Classification

```typescript
type SyncError =
  | { kind: 'connection_failed'; message: string }     // SSH connection error
  | { kind: 'transfer_failed'; path: string; message: string }  // File transfer error
  | { kind: 'hash_mismatch'; path: string; expected: string; actual: string }  // Verification error
  | { kind: 'restart_failed'; message: string }         // Gateway restart error
  | { kind: 'health_check_failed'; message: string };   // Post-restart health check error
```

---

## 10. Batch Operations

### Multi-Machine Sync

When pushing changes to multiple machines (e.g., updating a global skill):

```typescript
async function batchSync(machineIds: string[], triggeredBy: string): Promise<BatchSyncResult> {
  // Execute syncs in parallel (max concurrency: 5)
  const results = await pMap(machineIds, async (machineId) => {
    return syncEngine.fullSync(machineId, triggeredBy);
  }, { concurrency: 5 });

  return { results, summary: summarizeBatchResults(results) };
}
```

### Multi-Agent Update

When a change to `openclaw.json` affects all agents on a machine:

1. Pull latest `openclaw.json` from remote
2. Merge Console changes into the JSON structure
3. Push updated `openclaw.json`
4. Since `openclaw.json` changed → warm sync → Gateway restart
5. All agents on the machine reload with new config
