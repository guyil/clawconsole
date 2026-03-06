# ClawConsole — Module Map & Dependency Rules

> Version: 1.0 | Last Updated: 2026-03-06

## Project Structure

```
clawconsole/
├── docs/                              # Project documentation
│   ├── ARCHITECTURE.md                # System architecture overview
│   ├── DATABASE.md                    # Database schema design
│   ├── SYNC-ENGINE.md                 # Sync engine deep-dive
│   ├── FILE-CLASSIFICATION.md         # File classification reference
│   ├── API-REFERENCE.md              # API endpoint documentation
│   └── MODULE-MAP.md                 # This file
│
├── prd/                               # Product requirements
│   └── openclaw-prd.docx             # Original PRD document
│
└── backend/                           # Backend application
    ├── package.json
    ├── tsconfig.json
    ├── knexfile.ts                    # Database migration config
    ├── .env.example                   # Environment variables template
    │
    ├── src/
    │   ├── server.ts                  # Application entry point
    │   │
    │   ├── config/                    # Application configuration
    │   │   └── index.ts              # Loads env vars, exports typed config
    │   │
    │   ├── shared/                    # Shared utilities (no business logic)
    │   │   ├── db.ts                 # MySQL connection pool (Knex)
    │   │   ├── redis.ts              # Redis client (ioredis)
    │   │   ├── crypto.ts            # AES-256-GCM encryption
    │   │   ├── errors.ts            # Error classes
    │   │   ├── logger.ts            # Pino structured logger
    │   │   └── file-classifier.ts   # File category classification
    │   │
    │   ├── transport/                 # SSH/Tailscale transport layer
    │   │   ├── ssh-pool.ts          # SSH connection pool
    │   │   ├── ssh-executor.ts      # Remote command execution
    │   │   ├── file-transfer.ts     # SCP/rsync file transfer
    │   │   └── tailscale.ts         # Tailscale CLI integration
    │   │
    │   ├── parsers/                   # File format parsers (pure functions)
    │   │   ├── openclaw-json.parser.ts
    │   │   ├── markdown-frontmatter.parser.ts
    │   │   ├── manifest.parser.ts
    │   │   └── cron-jobs.parser.ts
    │   │
    │   ├── generators/                # File format generators (pure functions)
    │   │   ├── openclaw-json.generator.ts
    │   │   ├── workspace-files.generator.ts
    │   │   ├── skill-files.generator.ts
    │   │   └── cron-jobs.generator.ts
    │   │
    │   ├── modules/                   # Feature modules
    │   │   ├── machines/             # Machine/node management
    │   │   │   ├── machine.routes.ts
    │   │   │   ├── machine.service.ts
    │   │   │   ├── machine.repository.ts
    │   │   │   └── machine.types.ts
    │   │   │
    │   │   ├── agents/               # Agent lifecycle management
    │   │   │   ├── agent.routes.ts
    │   │   │   ├── agent.service.ts
    │   │   │   ├── agent.repository.ts
    │   │   │   └── agent.types.ts
    │   │   │
    │   │   ├── files/                # Managed file blob store
    │   │   │   ├── file.routes.ts
    │   │   │   ├── file.service.ts
    │   │   │   ├── file.repository.ts
    │   │   │   └── file.types.ts
    │   │   │
    │   │   ├── sync/                 # Sync engine (core module)
    │   │   │   ├── sync.routes.ts
    │   │   │   ├── sync.service.ts
    │   │   │   ├── sync.repository.ts
    │   │   │   ├── sync-engine.ts
    │   │   │   ├── diff-engine.ts
    │   │   │   ├── manifest-collector.ts
    │   │   │   ├── sync-mode-detector.ts
    │   │   │   ├── conflict-resolver.ts
    │   │   │   └── sync.types.ts
    │   │   │
    │   │   ├── skills/               # Skill catalog + distribution ✅
    │   │   │   ├── skill.routes.ts
    │   │   │   ├── skill.service.ts
    │   │   │   ├── skill.repository.ts
    │   │   │   └── skill.types.ts
    │   │   │
    │   │   ├── credentials/          # Credential vault ✅
    │   │   │   ├── credential.routes.ts
    │   │   │   ├── credential.service.ts
    │   │   │   ├── credential.repository.ts
    │   │   │   └── credential.types.ts
    │   │   │
    │   │   └── cron/                 # Cron job management (planned)
    │   │       ├── cron.routes.ts
    │   │       ├── cron.service.ts
    │   │       ├── cron.repository.ts
    │   │       └── cron.types.ts
    │   │
    │   ├── jobs/                      # Background workers (BullMQ)
    │   │   ├── queue.ts              # Queue definitions
    │   │   ├── health-check.job.ts
    │   │   ├── auto-pull.job.ts
    │   │   └── sync-retry.job.ts
    │   │
    │   └── websocket/                 # Real-time events ✅
    │       ├── ws-server.ts
    │       └── sync-events.ts
    │
    ├── tests/                         # Test files (102 tests passing)
    │   ├── unit/
    │   │   ├── parsers/              # markdown-frontmatter.test.ts
    │   │   ├── sync/                 # diff-engine, sync-mode-detector, conflict-resolver
    │   │   ├── shared/               # file-classifier.test.ts
    │   │   ├── websocket/            # sync-events.test.ts
    │   │   ├── credentials/          # credential.service.test.ts
    │   │   └── skills/               # skill.service.test.ts
    │   └── integration/
    │       ├── sync/
    │       └── transport/
    │
    └── database/
        └── migrations/               # Knex migration files
```

---

## Module Responsibilities

### `config/`
- Load environment variables
- Export typed configuration object
- Validate required config at startup

### `shared/`
- Database connection pool
- Redis client
- Encryption utilities
- Error types
- Logger
- File classification logic

### `transport/`
- SSH connection lifecycle management
- Remote command execution (with timeout, error handling)
- File upload/download (SCP)
- Directory sync (rsync)
- Tailscale status querying

### `parsers/`
- Parse `openclaw.json` (JSON5) into structured data
- Parse SKILL.md YAML frontmatter
- Parse remote manifest output (find + sha256sum)
- Parse `cron/jobs.json`

### `generators/`
- Generate `openclaw.json` from structured data
- Generate workspace markdown files from templates
- Generate skill directory with SKILL.md
- Generate `cron/jobs.json` from structured data

### `modules/machines/`
- CRUD operations for Tailscale nodes
- Health check orchestration
- Auto-discovery of OpenClaw structure on remote machines

### `modules/agents/`
- CRUD operations for agents
- Agent status tracking
- Workspace file listing

### `modules/files/`
- Blob storage CRUD for managed files
- File content hashing (SHA-256)
- Dirty flag management

### `modules/sync/`
- **sync-engine.ts**: Top-level orchestrator (pull → diff → push → verify)
- **diff-engine.ts**: Compare local DB state vs remote manifest
- **manifest-collector.ts**: SSH to remote, collect file hashes
- **sync-mode-detector.ts**: Determine hot/warm/cold based on changed files
- **conflict-resolver.ts**: Handle bidirectional conflicts
- **sync.service.ts**: API-facing sync operations, audit logging
- **sync.repository.ts**: CRUD for sync_operations and sync_operation_files

### `modules/skills/`
- **skill.types.ts**: TypeScript interfaces (`SkillCatalogEntry`, `AgentSkillInstall`, `CreateSkillInput`, etc.)
- **skill.repository.ts**: Catalog CRUD, agent skill install/uninstall with JOIN queries
- **skill.service.ts**: Business logic — CRUD, review workflow (approve/reject), import from remote machine, deploy to machine, agent skill management
- **skill.routes.ts**: REST endpoints with Zod validation — catalog CRUD, review, agent install/uninstall, import, deploy

### `modules/credentials/`
- **credential.types.ts**: TypeScript interfaces (`Credential`, `CreateCredentialInput`, etc.)
- **credential.repository.ts**: Encrypted CRUD — encrypts/decrypts values with AES-256-GCM via `shared/crypto.ts`
- **credential.service.ts**: Business logic — validation, sync-to-machine via SSH upload with 0o600 permissions
- **credential.routes.ts**: REST endpoints with Zod validation — CRUD, sync single, sync all to machine

### `modules/cron/`
- Cron job CRUD
- Maps to OpenClaw `cron/jobs.json` format

### `jobs/`
- BullMQ workers for background tasks
- Machine health polling
- Automatic remote change detection
- Failed sync retry

### `websocket/`
- **ws-server.ts**: Registers `@fastify/websocket` plugin, `/ws` endpoint, starts Redis subscriber
- **sync-events.ts**: Event type definitions, Redis Pub/Sub publishing, connected client tracking, typed emit helpers (`emitSyncStarted`, `emitSyncProgress`, `emitSyncCompleted`, `emitSyncConflict`, `emitMachineStatus`, `emitAgentStatus`)

---

## Dependency Rules

```
┌──────────────────────────────────────────────────────────┐
│                    modules/*                              │
│  (machines, agents, files, sync, skills, creds, cron)    │
│                                                          │
│  ✅ Can import from:                                      │
│     - shared/*                                           │
│     - transport/*                                        │
│     - parsers/*                                          │
│     - generators/*                                       │
│     - config/                                            │
│                                                          │
│  ❌ Must NOT import from:                                 │
│     - Other modules/* directly                           │
│     - jobs/*                                             │
│     - websocket/*                                        │
│                                                          │
│  Cross-module communication: via service injection       │
│  or event bus (Redis pub/sub)                            │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│                   transport/*                             │
│  ✅ Can import from: shared/*                             │
│  ❌ Must NOT import from: modules/*, parsers/*, generators/*│
│  (Transport is infrastructure-only, no business logic)   │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│                parsers/* | generators/*                   │
│  ✅ Can import from: shared/errors.ts, shared/logger.ts   │
│  ❌ Must NOT import from: modules/*, transport/*          │
│  (Pure functions, no I/O side effects)                   │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│                      jobs/*                               │
│  ✅ Can import from: modules/*/service, shared/*          │
│  (Workers use services to execute business logic)        │
└──────────────────────────────────────────────────────────┘
```

---

## Inter-Module Communication

When Module A needs functionality from Module B, there are two approaches:

### 1. Service Injection via Fastify Plugin

```typescript
// In server.ts, register services and inject dependencies
const machineService = new MachineService(machineRepo, sshPool);
const syncEngine = new SyncEngine(sshPool, diffEngine, fileRepo, syncRepo);
const syncService = new SyncService(syncEngine, machineService);

fastify.decorate('syncService', syncService);
fastify.decorate('machineService', machineService);
```

### 2. Event Bus via Redis Pub/Sub

```typescript
// Sync module publishes event
redis.publish('sync:completed', JSON.stringify({ machineId, operationId }));

// Machine module subscribes to update status
redis.subscribe('sync:completed', (msg) => {
  const { machineId } = JSON.parse(msg);
  machineService.updateLastSyncTime(machineId);
});
```
