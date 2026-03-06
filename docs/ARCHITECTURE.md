# ClawConsole — Technical Architecture Document

> Version: 1.0 | Last Updated: 2026-03-06

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Core Concept: File Synchronization System](#2-core-concept-file-synchronization-system)
3. [Entity Model](#3-entity-model)
4. [File Classification System](#4-file-classification-system)
5. [Sync Engine Architecture](#5-sync-engine-architecture)
6. [Backend Module Map](#6-backend-module-map)
7. [Database Design](#7-database-design)
8. [Transport Layer](#8-transport-layer)
9. [Background Jobs](#9-background-jobs)
10. [Security Model](#10-security-model)
11. [API Design Principles](#11-api-design-principles)

---

## 1. System Overview

ClawConsole is an enterprise management platform for OpenClaw AI Agents. At its core,
it is a **bidirectional file synchronization system** backed by a MySQL database.

### Why File Sync?

OpenClaw is entirely file-driven. All agent configuration — persona (SOUL.md),
behavior rules (AGENTS.md), skills (SKILL.md), scheduled tasks (jobs.json), and
the central config (openclaw.json) — lives as files on disk under `~/.openclaw/`.

ClawConsole does **not** modify the OpenClaw runtime. Instead, it manages the file
system that OpenClaw reads from, and reads the runtime files that OpenClaw writes to.

### Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                    ClawConsole Backend                            │
│                                                                  │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────────────┐   │
│  │ Fastify API  │  │ Sync Engine  │  │ Background Jobs       │   │
│  │ + WebSocket  │  │              │  │ (BullMQ)              │   │
│  └──────┬───────┘  └──────┬───────┘  └───────────┬───────────┘   │
│         │                 │                      │               │
│  ┌──────┴─────────────────┴──────────────────────┴───────────┐   │
│  │              Data Layer: MySQL + Redis                     │   │
│  └───────────────────────────┬────────────────────────────────┘   │
│                              │                                   │
│  ┌───────────────────────────┴────────────────────────────────┐   │
│  │          Transport Layer: SSH Connection Pool               │   │
│  │          (ssh2 over Tailscale WireGuard tunnel)             │   │
│  └───────────────────────────┬────────────────────────────────┘   │
└──────────────────────────────┼───────────────────────────────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
     ┌────────▼──────┐ ┌──────▼────────┐ ┌─────▼───────────┐
     │ Machine A      │ │ Machine B      │ │ Machine C        │
     │ ~/.openclaw/   │ │ ~/.openclaw/   │ │ ~/.openclaw/     │
     │ (多 Agent)     │ │ (多 Agent)     │ │ (多 Agent)       │
     └────────────────┘ └────────────────┘ └──────────────────┘
              ▲                ▲                ▲
              └────────────────┴────────────────┘
                      Tailscale Tailnet
                   (WireGuard encrypted)
```

---

## 2. Core Concept: File Synchronization System

### 2.1 Design Principles

| Principle | Description |
|-----------|-------------|
| **Database as Mirror** | MySQL stores a copy of every managed file from every remote machine |
| **Pull-Before-Push** | Before any Console edit, pull latest remote state to detect changes |
| **Blob Storage** | File contents stored as-is (LONGTEXT), not parsed into relational fields |
| **Classification-Driven** | Every file has a category that determines its sync behavior |
| **Partial Failure Tolerance** | Failed syncs are recorded and retryable, never block the system |
| **Audit Everything** | Every sync operation is logged with before/after file hashes |

### 2.2 Sync Flow

```
User Edit ──► DB Write ──► Push Trigger ──► Diff Engine ──► Transfer ──► Verify
                                ▲
                                │
                    Pull Trigger ──► Manifest Collect ──► Diff ──► Download ──► DB Update
```

### 2.3 The Pull-Before-Push Protocol

This is the most critical protocol in the system:

1. **Collect Manifest** — SSH to remote, run `find + sha256sum` to get file hashes
2. **Compare** — Compare remote hashes against `managed_files.remote_hash` in DB
3. **Download Changes** — If remote files changed, download them and update DB
4. **Show Conflicts** — If both remote and local changed, show diff to user
5. **Apply User Edits** — User makes changes in Console
6. **Push** — Upload modified files to remote via SSH/SCP
7. **Verify** — Confirm files arrived intact (hash check)
8. **Post-Action** — If warm/cold sync, restart Gateway

---

## 3. Entity Model

### 3.1 Correcting the PRD's Assumptions

The PRD assumed 1 Machine = 1 Bot. The actual OpenClaw architecture is:

```
Machine (Tailscale Node)
  └── OpenClaw Instance (~/.openclaw/)     ← one per machine
       ├── openclaw.json                    ← shared config for ALL agents
       ├── Global Resources                 ← shared skills, hooks, cron
       └── Agents (1..N)                    ← multiple agents per machine
            ├── pm
            ├── brand_manager
            ├── sales_manager
            └── ...
```

### 3.2 Entity Relationships

```
Machine (1) ──── (N) Agent
Machine (1) ──── (N) ManagedFile
Agent   (1) ──── (N) ManagedFile (agent-scoped files)
Machine (1) ──── (N) SyncOperation
SyncOperation (1) ──── (N) SyncOperationFile
ManagedFile (1) ──── (N) SyncOperationFile
```

### 3.3 Key Distinction: Machine-Level vs Agent-Level

| Scope | Examples | Implications |
|-------|----------|--------------|
| Machine-level | `openclaw.json`, global `skills/`, `hooks/`, `cron/`, `credentials/` | Changes affect ALL agents on the machine |
| Agent-level | `workspace-pm/SOUL.md`, `workspace-pm/skills/`, `agents/pm/sessions/` | Changes affect only one agent |

When editing `openclaw.json` (especially `agents.list`, `channels`, `bindings`), the
Console must understand that this is a machine-wide operation.

---

## 4. File Classification System

Every file under `~/.openclaw/` belongs to one of four categories.
This classification is the foundation of the sync engine.

### Category A: Console-Managed (Push direction)

Console is the source of truth. Console generates/edits these files and pushes to remote.

| Path Pattern | Type | Description |
|-------------|------|-------------|
| `openclaw.json` | config | Global config (agents, channels, bindings, skills, models, etc.) |
| `workspace-{id}/SOUL.md` | persona | Agent persona/character definition |
| `workspace-{id}/IDENTITY.md` | persona | Agent identity info |
| `workspace-{id}/USER.md` | persona | User/boss context |
| `workspace-{id}/AGENTS.md` | persona | Multi-agent collaboration defs |
| `workspace-{id}/TOOLS.md` | persona | Tool usage notes |
| `workspace-{id}/BOOTSTRAP.md` | persona | Startup instructions |
| `workspace-{id}/HEARTBEAT.md` | persona | Heartbeat task checklist |
| `workspace-{id}/README.md` | persona | Agent overview |
| `workspace-{id}/skills/**` | skill | Per-agent skills |
| `workspace-{id}/config/**` | config | Per-agent config |
| `skills/**` | skill | Global shared skills |
| `hooks/**/HOOK.md` | hook | Custom hook definitions |
| `hooks/**/handler.ts` | hook | Custom hook handlers |
| `cron/jobs.json` | cron | Scheduled job definitions |
| `credentials/*-allowFrom.json` | credential | Channel message allowlists |

### Category B: Runtime-Observable (Pull direction, read-only)

Console reads these for monitoring but never modifies them.

| Path Pattern | Type | Description |
|-------------|------|-------------|
| `agents/{id}/sessions/**` | session | Session data and conversation history |
| `agents/{id}/agent/auth-profiles.json` | config | LLM auth profiles (runtime) |
| `agents/{id}/agent/models.json` | config | Available models (runtime) |
| `memory/*.sqlite` | memory | Agent memory databases |
| `workspace-{id}/memory/**` | memory | Daily memory markdown logs |
| `logs/**` | log | Gateway and command logs |
| `cron/runs/**` | cron | Cron execution records |
| `subagents/runs.json` | runtime | Sub-agent run records |
| `delivery-queue/**` | runtime | Message delivery queue |
| `feishu/dedup/**` | runtime | Channel dedup state |
| `devices/**` | runtime | Device pairing state |

### Category C: System-Internal (Never Touch)

| Path Pattern | Description |
|-------------|-------------|
| `identity/**` | Machine-unique device identity and auth |
| `update-check.json` | Version check state |
| `openclaw.json.bak*` | Auto-backup files |
| `workspace-{id}/.git/**` | Git version control |
| `workspace-{id}/.openclaw/**` | Workspace onboarding state |
| `completions/**` | Shell auto-completion scripts |
| `browser/**` | Browser tool data |
| `canvas/**` | Canvas UI assets |

### Category D: Bidirectional (Conflict possible)

Category A files that may also be modified by agents at runtime (e.g., self-improving
agents editing their own SOUL.md). Conflict resolution applies here — see Section 5.4.

### Classification Logic

```typescript
function classifyFile(relativePath: string): FileCategory {
  // Category C: Never touch
  if (matchesAny(relativePath, SYSTEM_INTERNAL_PATTERNS)) return 'system_internal';
  
  // Category B: Runtime-observable
  if (matchesAny(relativePath, RUNTIME_OBSERVABLE_PATTERNS)) return 'runtime_observable';
  
  // Category A: Console-managed
  if (matchesAny(relativePath, CONSOLE_MANAGED_PATTERNS)) return 'console_managed';
  
  // Default: treat as system_internal (don't touch unknown files)
  return 'system_internal';
}
```

---

## 5. Sync Engine Architecture

### 5.1 Components

```
SyncEngine (orchestrator)
├── ManifestCollector      — Collects remote file state (path, hash, mtime, size)
├── DiffEngine             — Compares local DB state vs remote manifest
├── SyncModeDetector       — Determines hot/warm/cold based on changed files
├── ConflictResolver       — Handles bidirectional conflicts
├── FileTransfer           — Uploads/downloads files via SSH
└── PostSyncVerifier       — Runs openclaw doctor, health checks
```

### 5.2 Manifest Collection

Rather than transferring all files, we first collect a lightweight manifest:

```bash
cd ~/.openclaw && find . -type f \
  ! -path './.git/*' ! -path '*/node_modules/*' \
  ! -path './browser/*' ! -path './canvas/*' \
  ! -path './completions/*' ! -path './identity/*' \
  -exec sha256sum {} \; 2>/dev/null
```

Output is parsed into `{ path, hash }` tuples and compared against DB.

### 5.3 Three Sync Modes

| Mode | Trigger | Actions | Gateway Restart? |
|------|---------|---------|-----------------|
| **Hot** | Only workspace `.md` files or existing skill content changed | SCP individual files | No |
| **Warm** | `openclaw.json` changed, skill dir structure changed, cron/hooks changed | rsync incremental + restart | Yes |
| **Cold** | OpenClaw version upgrade or explicit user request | Full package + npm update + restart | Yes |

Detection is automatic based on which files are in the push set.

### 5.4 Conflict Resolution Strategy

When the same file has been modified both locally (Console) and remotely (agent runtime):

| File Type | Strategy |
|-----------|----------|
| Runtime files (memory/, sessions/) | Remote always wins (pull only) |
| Config files (openclaw.json) | Console always wins (Console is authority) |
| Persona files (SOUL.md, etc.) | Show diff to user, let user choose |
| Skill files | Show diff to user, let user choose |

### 5.5 Failure Handling

- Partial sync: record which files succeeded/failed in `sync_operation_files`
- Set operation status to `partial_failure`
- BullMQ retry job picks up failed operations (max 3 retries)
- Frontend shows sync status with file-level detail via WebSocket

---

## 6. Backend Module Map

```
backend/src/
├── server.ts                          # Fastify entry point
├── config/
│   └── index.ts                       # App configuration (env vars, DB, Redis)
│
├── modules/                           # Feature modules (each is self-contained)
│   ├── machines/                      # Tailscale node management
│   │   ├── machine.routes.ts          #   API routes
│   │   ├── machine.service.ts         #   Business logic
│   │   ├── machine.repository.ts      #   Database queries
│   │   └── machine.types.ts           #   TypeScript types
│   │
│   ├── agents/                        # Agent lifecycle management
│   │   ├── agent.routes.ts
│   │   ├── agent.service.ts
│   │   ├── agent.repository.ts
│   │   └── agent.types.ts
│   │
│   ├── files/                         # Managed file CRUD (blob store)
│   │   ├── file.routes.ts
│   │   ├── file.service.ts
│   │   ├── file.repository.ts
│   │   └── file.types.ts
│   │
│   ├── sync/                          # Core sync engine
│   │   ├── sync.routes.ts             #   Sync trigger/status APIs
│   │   ├── sync.service.ts            #   Sync operation orchestration
│   │   ├── sync.repository.ts         #   Sync history queries
│   │   ├── sync-engine.ts             #   Pull/Push/FullSync orchestrator
│   │   ├── diff-engine.ts             #   File hash comparison + diff
│   │   ├── manifest-collector.ts      #   Remote file manifest via SSH
│   │   ├── sync-mode-detector.ts      #   Hot/Warm/Cold detection
│   │   ├── conflict-resolver.ts       #   Conflict resolution logic
│   │   └── sync.types.ts              #   Sync-specific types
│   │
│   ├── skills/                        # Skill catalog + distribution
│   ├── credentials/                   # Encrypted credential vault
│   └── cron/                          # Cron job management
│
├── transport/                         # Low-level SSH/Tailscale layer
│   ├── ssh-pool.ts                    # SSH connection pool
│   ├── ssh-executor.ts                # Remote command execution
│   ├── file-transfer.ts               # SCP/rsync wrappers
│   └── tailscale.ts                   # Tailscale CLI integration
│
├── generators/                        # DB → OpenClaw file format
│   ├── openclaw-json.generator.ts     # Generate openclaw.json
│   ├── workspace-files.generator.ts   # Generate workspace .md files
│   ├── skill-files.generator.ts       # Generate skill directories
│   └── cron-jobs.generator.ts         # Generate cron/jobs.json
│
├── parsers/                           # OpenClaw file format → DB
│   ├── openclaw-json.parser.ts        # Parse openclaw.json (JSON5)
│   ├── markdown-frontmatter.parser.ts # Parse SKILL.md YAML frontmatter
│   ├── manifest.parser.ts             # Parse remote file manifest
│   └── cron-jobs.parser.ts            # Parse cron/jobs.json
│
├── jobs/                              # BullMQ background workers
│   ├── health-check.job.ts            # Machine health polling
│   ├── auto-pull.job.ts               # Periodic remote change detection
│   └── sync-retry.job.ts              # Retry failed syncs
│
├── websocket/                         # Real-time events
│   ├── ws-server.ts                   # WebSocket setup
│   └── sync-events.ts                 # Sync progress event emitter
│
└── shared/                            # Shared utilities
    ├── db.ts                          # MySQL connection pool (knex)
    ├── redis.ts                       # Redis client (ioredis)
    ├── crypto.ts                      # AES-256-GCM for credentials
    ├── errors.ts                      # Typed error classes
    ├── logger.ts                      # Pino structured logger
    └── file-classifier.ts             # File category classification
```

### Module Dependency Rules

1. `modules/*` can import from `shared/`, `transport/`, `parsers/`, `generators/`
2. `modules/*` must NOT import from other `modules/*` directly — use service injection
3. `transport/` is standalone, no dependencies on modules
4. `parsers/` and `generators/` are pure functions, no side effects
5. `jobs/` can import from `modules/*/service` to execute business logic

---

## 7. Database Design

See `docs/DATABASE.md` for full schema definition.

### Core Tables Summary

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `machines` | Tailscale nodes | hostname, ip, status, openclaw_version |
| `agents` | AI agents per machine | machine_id, agent_id, status, workspace_path |
| `managed_files` | File blob storage | machine_id, agent_id, relative_path, content, content_hash, remote_hash |
| `sync_operations` | Sync audit log | machine_id, sync_type, direction, status, file counts |
| `sync_operation_files` | Per-file sync detail | operation_id, file_id, action, status, before/after hash |
| `credentials_store` | Encrypted credentials | machine_id, provider, encrypted_value, target_path |
| `skills_catalog` | Skill registry | skill_key, source, frontmatter, review_status |

---

## 8. Transport Layer

### SSH Connection Pool

- Uses `ssh2` npm package (pure JavaScript SSH2 client)
- Maintains persistent connections per machine (max 2 per machine)
- Connections are recycled after 5 minutes of idle
- All connections go through Tailscale tunnel (host = `{hostname}.tailnet`)

### File Transfer Methods

| Method | Use Case | Implementation |
|--------|----------|---------------|
| SCP (single file) | Hot sync individual files | `ssh2` SFTP subsystem |
| rsync (directory) | Warm sync with exclusions | Spawn `rsync -e "ssh -o ..."` subprocess |
| Stream pipe | Credential transfer (no temp file) | `ssh2` exec with stdin pipe |

### Tailscale Integration

- `tailscale status --json` to discover nodes and online status
- `tailscale ping {hostname}` to check connectivity
- Console server itself is in the Tailnet

---

## 9. Background Jobs

Powered by BullMQ (Redis-backed job queue).

| Job | Schedule | Purpose |
|-----|----------|---------|
| `machine-health-check` | Every 60s | Check machine online status via Tailscale + SSH |
| `auto-pull-sync` | Every 5 min | Collect manifest, detect remote file changes |
| `sync-retry` | Every 2 min | Retry failed/partial sync operations (max 3) |
| `log-collector` | Every 10 min | Pull gateway.log tail for monitoring |
| `session-stats` | Every 5 min | Pull session counts for dashboard |

---

## 10. Security Model

| Aspect | Implementation |
|--------|---------------|
| Network | All traffic over Tailscale WireGuard tunnel, zero public exposure |
| Credentials at rest | AES-256-GCM encrypted in MySQL, key from env var |
| Credentials in transit | Piped through SSH stdin, never written to temp files |
| Audit | Every sync operation logged with user, timestamp, file details |
| SSH keys | Managed per-machine, stored in Console's config |

---

## 11. API Design Principles

1. **RESTful with resource hierarchy**: `/api/machines/:machineId/agents/:agentId/files/...`
2. **Sync is explicit**: Editing a file only changes the DB; pushing requires a separate API call
3. **WebSocket for real-time**: Sync progress, machine status changes, job completions
4. **Validation with Zod**: Request/response schemas validated at the route level
5. **Consistent error format**: `{ error: string, code: string, details?: object }`
