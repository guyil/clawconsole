# ClawConsole — Database Schema Design

> Version: 1.0 | Last Updated: 2026-03-06
> Database: MySQL 8.0+

## Table of Contents

1. [Entity Relationship Diagram](#1-entity-relationship-diagram)
2. [Table Definitions](#2-table-definitions)
3. [Index Strategy](#3-index-strategy)
4. [Migration Strategy](#4-migration-strategy)

---

## 1. Entity Relationship Diagram

```
machines ─────────────┬──────────────────── agents
   │                  │                       │
   │                  │                       │
   │                  ▼                       │
   │            managed_files ◄───────────────┘
   │                  │
   │                  │
   ▼                  ▼
sync_operations ─── sync_operation_files
   
   
machines ──── credentials_store

skills_catalog ──── agent_skills ──── agents
```

### Key Relationships

- `machines` 1:N `agents` — One machine has many agents
- `machines` 1:N `managed_files` — Files belong to a machine
- `agents` 1:N `managed_files` — Agent-scoped files (nullable FK for machine-level files)
- `machines` 1:N `sync_operations` — Sync history per machine
- `sync_operations` 1:N `sync_operation_files` — Per-file detail within an operation
- `managed_files` 1:N `sync_operation_files` — File participation in syncs
- `skills_catalog` 1:N `agent_skills` — Skills installed on agents
- `agents` 1:N `agent_skills` — Which skills an agent has

---

## 2. Table Definitions

### 2.1 machines

Represents a Tailscale node running OpenClaw.

```sql
CREATE TABLE machines (
  id            CHAR(36)      NOT NULL PRIMARY KEY,
  name          VARCHAR(255)  NOT NULL,
  tailscale_hostname VARCHAR(255) NOT NULL UNIQUE,
  tailscale_ip  VARCHAR(45)   DEFAULT NULL,
  ssh_user      VARCHAR(100)  NOT NULL DEFAULT 'claw',
  ssh_port      INT           NOT NULL DEFAULT 22,
  os_info       VARCHAR(255)  DEFAULT NULL,
  openclaw_version VARCHAR(50) DEFAULT NULL,
  openclaw_home VARCHAR(500)  NOT NULL DEFAULT '~/.openclaw',
  status        ENUM('online','offline','unknown') NOT NULL DEFAULT 'unknown',
  last_health_check_at DATETIME DEFAULT NULL,
  tags          JSON          DEFAULT NULL,
  created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### 2.2 agents

Individual AI agents within an OpenClaw instance.

```sql
CREATE TABLE agents (
  id            CHAR(36)      NOT NULL PRIMARY KEY,
  machine_id    CHAR(36)      NOT NULL,
  agent_id      VARCHAR(100)  NOT NULL COMMENT 'OpenClaw agent ID, e.g. pm, brand_manager',
  name          VARCHAR(255)  DEFAULT NULL,
  description   TEXT          DEFAULT NULL,
  is_default    BOOLEAN       NOT NULL DEFAULT FALSE,
  workspace_path VARCHAR(500) DEFAULT NULL COMMENT 'Resolved workspace directory path',
  status        ENUM('draft','packaging','syncing','online','degraded','offline','archived')
                NOT NULL DEFAULT 'draft',
  last_synced_at DATETIME     DEFAULT NULL,
  created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uk_machine_agent (machine_id, agent_id),
  CONSTRAINT fk_agents_machine FOREIGN KEY (machine_id) REFERENCES machines(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### 2.3 managed_files

Core table: stores file content blobs with sync state tracking.

```sql
CREATE TABLE managed_files (
  id            CHAR(36)      NOT NULL PRIMARY KEY,
  machine_id    CHAR(36)      NOT NULL,
  agent_id      CHAR(36)      DEFAULT NULL COMMENT 'NULL for machine-level files',
  relative_path VARCHAR(1000) NOT NULL COMMENT 'Path relative to ~/.openclaw/',
  file_category ENUM('console_managed','runtime_observable','system_internal')
                NOT NULL DEFAULT 'console_managed',
  file_type     ENUM('config','persona','skill','credential','cron','hook','log','session','memory','other')
                NOT NULL DEFAULT 'other',
  content       LONGTEXT      DEFAULT NULL COMMENT 'File content as text blob',
  content_hash  CHAR(64)      DEFAULT NULL COMMENT 'SHA-256 of content in DB',
  remote_hash   CHAR(64)      DEFAULT NULL COMMENT 'Last known SHA-256 on remote machine',
  remote_mtime  BIGINT        DEFAULT NULL COMMENT 'Last known mtime on remote (unix epoch ms)',
  remote_size   BIGINT        DEFAULT NULL COMMENT 'Last known file size in bytes',
  local_dirty   BOOLEAN       NOT NULL DEFAULT FALSE COMMENT 'TRUE if edited in Console but not synced',
  remote_dirty  BOOLEAN       NOT NULL DEFAULT FALSE COMMENT 'TRUE if remote changed since last pull',
  created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uk_machine_path (machine_id, relative_path(255)),
  KEY idx_machine_dirty (machine_id, local_dirty),
  KEY idx_machine_remote_dirty (machine_id, remote_dirty),
  KEY idx_agent_files (agent_id),
  KEY idx_file_category (file_category),
  CONSTRAINT fk_files_machine FOREIGN KEY (machine_id) REFERENCES machines(id) ON DELETE CASCADE,
  CONSTRAINT fk_files_agent FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### 2.4 sync_operations

Audit log of every sync operation performed.

```sql
CREATE TABLE sync_operations (
  id              CHAR(36)      NOT NULL PRIMARY KEY,
  machine_id      CHAR(36)      NOT NULL,
  sync_type       ENUM('hot','warm','cold','pull','full_pull') NOT NULL,
  sync_direction  ENUM('push','pull','bidirectional') NOT NULL,
  status          ENUM('pending','in_progress','completed','partial_failure','failed')
                  NOT NULL DEFAULT 'pending',
  triggered_by    VARCHAR(100)  DEFAULT NULL COMMENT 'Username or system',
  total_files     INT           NOT NULL DEFAULT 0,
  synced_files    INT           NOT NULL DEFAULT 0,
  failed_files    INT           NOT NULL DEFAULT 0,
  error_message   TEXT          DEFAULT NULL,
  started_at      DATETIME      DEFAULT NULL,
  completed_at    DATETIME      DEFAULT NULL,
  duration_ms     INT           DEFAULT NULL,
  requires_restart BOOLEAN      NOT NULL DEFAULT FALSE,
  restart_performed BOOLEAN     NOT NULL DEFAULT FALSE,
  retry_count     INT           NOT NULL DEFAULT 0,
  parent_operation_id CHAR(36)  DEFAULT NULL COMMENT 'If this is a retry of a previous operation',
  created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,

  KEY idx_machine_ops (machine_id, created_at DESC),
  KEY idx_status (status),
  CONSTRAINT fk_sync_machine FOREIGN KEY (machine_id) REFERENCES machines(id) ON DELETE CASCADE,
  CONSTRAINT fk_sync_parent FOREIGN KEY (parent_operation_id) REFERENCES sync_operations(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### 2.5 sync_operation_files

Per-file detail within a sync operation. Enables file-level retry and audit.

```sql
CREATE TABLE sync_operation_files (
  id                CHAR(36)      NOT NULL PRIMARY KEY,
  sync_operation_id CHAR(36)      NOT NULL,
  managed_file_id   CHAR(36)      DEFAULT NULL,
  relative_path     VARCHAR(1000) NOT NULL,
  action            ENUM('create','update','delete','skip','conflict') NOT NULL,
  status            ENUM('pending','completed','failed','skipped') NOT NULL DEFAULT 'pending',
  before_hash       CHAR(64)      DEFAULT NULL,
  after_hash        CHAR(64)      DEFAULT NULL,
  file_size_bytes   BIGINT        DEFAULT NULL,
  error_message     TEXT          DEFAULT NULL,
  created_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,

  KEY idx_op_files (sync_operation_id),
  KEY idx_file_history (managed_file_id),
  CONSTRAINT fk_opfile_op FOREIGN KEY (sync_operation_id) REFERENCES sync_operations(id) ON DELETE CASCADE,
  CONSTRAINT fk_opfile_file FOREIGN KEY (managed_file_id) REFERENCES managed_files(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### 2.6 credentials_store

Encrypted credential vault.

```sql
CREATE TABLE credentials_store (
  id              CHAR(36)      NOT NULL PRIMARY KEY,
  machine_id      CHAR(36)      DEFAULT NULL COMMENT 'NULL for global credentials',
  name            VARCHAR(255)  NOT NULL,
  credential_type ENUM('api_key','oauth_token','allow_from','pairing','webhook_secret','other')
                  NOT NULL,
  provider        VARCHAR(100)  DEFAULT NULL COMMENT 'e.g. anthropic, feishu, openrouter',
  encrypted_value TEXT          NOT NULL COMMENT 'AES-256-GCM encrypted JSON',
  encryption_iv   CHAR(32)      NOT NULL COMMENT 'Initialization vector (hex)',
  encryption_tag  CHAR(32)      NOT NULL COMMENT 'Auth tag (hex)',
  target_file_path VARCHAR(500) DEFAULT NULL COMMENT 'Target path under credentials/',
  description     TEXT          DEFAULT NULL,
  created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  KEY idx_cred_machine (machine_id),
  KEY idx_cred_provider (provider),
  CONSTRAINT fk_cred_machine FOREIGN KEY (machine_id) REFERENCES machines(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### 2.7 skills_catalog

Skill registry for enterprise skill management.

```sql
CREATE TABLE skills_catalog (
  id              CHAR(36)      NOT NULL PRIMARY KEY,
  skill_key       VARCHAR(255)  NOT NULL UNIQUE COMMENT 'Unique skill identifier',
  name            VARCHAR(255)  NOT NULL,
  description     TEXT          DEFAULT NULL,
  scope           ENUM('global','agent') NOT NULL DEFAULT 'global',
  source          ENUM('clawhub','custom','bundled') NOT NULL DEFAULT 'custom',
  version         VARCHAR(50)   DEFAULT NULL,
  frontmatter     JSON          DEFAULT NULL COMMENT 'Parsed YAML frontmatter as JSON',
  skill_md_content LONGTEXT     DEFAULT NULL COMMENT 'Full SKILL.md content',
  auxiliary_files JSON          DEFAULT NULL COMMENT 'List of other files in skill directory',
  requires_bins   JSON          DEFAULT NULL COMMENT '["gh","node",...]',
  requires_env    JSON          DEFAULT NULL COMMENT '["API_KEY",...]',
  review_status   ENUM('pending','approved','rejected','deprecated')
                  NOT NULL DEFAULT 'pending',
  reviewed_by     VARCHAR(100)  DEFAULT NULL,
  reviewed_at     DATETIME      DEFAULT NULL,
  created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  KEY idx_skill_source (source),
  KEY idx_skill_status (review_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### 2.8 agent_skills

Junction table: which skills are installed on which agents.

```sql
CREATE TABLE agent_skills (
  id              CHAR(36)      NOT NULL PRIMARY KEY,
  agent_id        CHAR(36)      NOT NULL,
  skill_catalog_id CHAR(36)     NOT NULL,
  scope           ENUM('global','agent') NOT NULL DEFAULT 'agent'
                  COMMENT 'global = in ~/.openclaw/skills/, agent = in workspace/skills/',
  enabled         BOOLEAN       NOT NULL DEFAULT TRUE,
  config_overrides JSON         DEFAULT NULL COMMENT 'Per-agent skill config overrides',
  installed_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE KEY uk_agent_skill (agent_id, skill_catalog_id),
  CONSTRAINT fk_as_agent FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
  CONSTRAINT fk_as_skill FOREIGN KEY (skill_catalog_id) REFERENCES skills_catalog(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

---

## 3. Index Strategy

### Primary Query Patterns

| Query | Table | Index |
|-------|-------|-------|
| List agents by machine | `agents` | `fk_agents_machine` (machine_id) |
| List dirty files for sync | `managed_files` | `idx_machine_dirty` (machine_id, local_dirty) |
| List files changed remotely | `managed_files` | `idx_machine_remote_dirty` (machine_id, remote_dirty) |
| Find file by path | `managed_files` | `uk_machine_path` (machine_id, relative_path) |
| List sync history | `sync_operations` | `idx_machine_ops` (machine_id, created_at DESC) |
| Find failed syncs | `sync_operations` | `idx_status` (status) |
| Get files in an operation | `sync_operation_files` | `idx_op_files` (sync_operation_id) |

### Text Column Length Limits

MySQL `UNIQUE` indexes on `VARCHAR` columns have a max key length. For `relative_path`
(VARCHAR 1000), we use a prefix index: `UNIQUE KEY uk_machine_path (machine_id, relative_path(255))`.

This means paths longer than 255 chars could theoretically collide in the unique constraint,
but OpenClaw paths are typically under 200 characters.

---

## 4. Migration Strategy

Using **Knex.js migrations** for schema versioning:

```
backend/src/database/migrations/
├── 001_create_machines.ts
├── 002_create_agents.ts
├── 003_create_managed_files.ts
├── 004_create_sync_operations.ts
├── 005_create_sync_operation_files.ts
├── 006_create_credentials_store.ts
├── 007_create_skills_catalog.ts
└── 008_create_agent_skills.ts
```

Each migration is idempotent and includes both `up()` and `down()` methods.
