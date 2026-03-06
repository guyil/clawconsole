# ClawConsole — API Reference

> Version: 1.0 | Last Updated: 2026-03-06
> Base URL: `http://localhost:3000/api`

## Table of Contents

1. [Conventions](#1-conventions)
2. [Machines API](#2-machines-api)
3. [Agents API](#3-agents-api)
4. [Files API](#4-files-api)
5. [Sync API](#5-sync-api)
6. [Skills API](#6-skills-api)
7. [Credentials API](#7-credentials-api)
8. [Cron API](#8-cron-api)
9. [WebSocket Events](#9-websocket-events)

---

## 1. Conventions

### Request/Response Format

- All request/response bodies are JSON
- Dates are ISO 8601 strings
- IDs are UUID v4 strings
- Pagination: `?page=1&pageSize=20`

### Error Format

```json
{
  "error": "Human-readable error message",
  "code": "MACHINE_NOT_FOUND",
  "details": {}
}
```

### Common Status Codes

| Code | Meaning |
|------|---------|
| 200 | Success |
| 201 | Created |
| 400 | Validation error |
| 404 | Resource not found |
| 409 | Conflict (sync conflict) |
| 500 | Internal server error |
| 503 | Machine unreachable |

---

## 2. Machines API

### List Machines

`GET /api/machines`

Query params: `?status=online&tag=production`

Response:
```json
{
  "data": [
    {
      "id": "uuid",
      "name": "CS Bot Server",
      "tailscaleHostname": "cs-bot.tailnet",
      "tailscaleIp": "100.64.1.10",
      "osInfo": "Ubuntu 24.04",
      "openclawVersion": "0.9.2",
      "status": "online",
      "agentCount": 3,
      "lastHealthCheckAt": "2026-03-06T10:00:00Z"
    }
  ],
  "total": 5
}
```

### Register Machine

`POST /api/machines`

Body:
```json
{
  "name": "CS Bot Server",
  "tailscaleHostname": "cs-bot.tailnet",
  "sshUser": "claw",
  "sshPort": 22,
  "openclawHome": "~/.openclaw",
  "tags": ["production", "asia"]
}
```

### Get Machine Details

`GET /api/machines/:machineId`

Includes agent list and last sync status.

### Check Machine Health

`POST /api/machines/:machineId/health-check`

Runs `tailscale ping` + SSH connectivity test + `openclaw --version`.

Response:
```json
{
  "status": "online",
  "tailscalePing": { "latencyMs": 12 },
  "sshConnectivity": true,
  "openclawVersion": "0.9.2",
  "gatewayStatus": "active",
  "checkedAt": "2026-03-06T10:00:00Z"
}
```

### Discover Machine Structure

`POST /api/machines/:machineId/discover`

SSH into the machine, scan `~/.openclaw/` structure, auto-detect agents
and populate the database.

Response:
```json
{
  "agents": [
    { "agentId": "pm", "workspacePath": "workspace-pm", "isDefault": false },
    { "agentId": "brand_manager", "workspacePath": "workspace-brand_manager", "isDefault": false },
    { "agentId": "main", "workspacePath": "workspace", "isDefault": true }
  ],
  "globalSkills": ["amazon-scraper", "data-analysis", "find-skills"],
  "cronJobs": 5,
  "fileCount": 187
}
```

### Delete Machine

`DELETE /api/machines/:machineId`

Removes machine and all associated data from Console DB. Does NOT affect
the remote machine's files.

---

## 3. Agents API

### List Agents on a Machine

`GET /api/machines/:machineId/agents`

### Create Agent

`POST /api/machines/:machineId/agents`

Body:
```json
{
  "agentId": "customer_support",
  "name": "Customer Support Bot",
  "description": "Handles customer inquiries via Feishu",
  "isDefault": false
}
```

This creates the agent record in DB. To deploy it, push `openclaw.json`
with the new agent entry + create workspace files + sync.

### Get Agent Details

`GET /api/agents/:agentId`

Response includes agent metadata, workspace files list, status, and last sync info.

### Update Agent Status

`PATCH /api/agents/:agentId`

Body:
```json
{
  "status": "archived",
  "name": "Updated Name"
}
```

---

## 4. Files API

### List Files for a Machine

`GET /api/machines/:machineId/files`

Query params: `?category=console_managed&type=persona&agentId=uuid&dirty=true`

### List Files for an Agent

`GET /api/agents/:agentId/files`

Returns only agent-scoped files (workspace and agent dir files).

### Get File Content

`GET /api/files/:fileId`

Response:
```json
{
  "id": "uuid",
  "relativePath": "workspace-pm/SOUL.md",
  "fileCategory": "console_managed",
  "fileType": "persona",
  "content": "# PM Agent\n\nYou are a project manager...",
  "contentHash": "sha256...",
  "remoteHash": "sha256...",
  "localDirty": false,
  "remoteDirty": false,
  "updatedAt": "2026-03-06T10:00:00Z"
}
```

### Update File Content

`PUT /api/files/:fileId`

Body:
```json
{
  "content": "# PM Agent\n\nYou are an experienced project manager..."
}
```

This updates the DB only. Sets `local_dirty = true`.
To push to remote, use the Sync API.

### Get File by Path

`GET /api/machines/:machineId/files/by-path?path=workspace-pm/SOUL.md`

### Batch Get Files

`POST /api/machines/:machineId/files/batch`

Body:
```json
{
  "paths": [
    "workspace-pm/SOUL.md",
    "workspace-pm/AGENTS.md",
    "workspace-pm/TOOLS.md"
  ]
}
```

---

## 5. Sync API

### Pull Remote State

`POST /api/machines/:machineId/sync/pull`

Pulls latest file state from remote machine to Console DB.

Response:
```json
{
  "operationId": "uuid",
  "status": "completed",
  "remoteNew": 2,
  "remoteModified": 3,
  "remoteDeleted": 0,
  "totalPulled": 5,
  "durationMs": 1200
}
```

### Preview Push Plan (Dry Run)

`GET /api/machines/:machineId/sync/plan`

Returns what would happen if you pushed now, without actually pushing.

Response:
```json
{
  "syncMode": "hot",
  "filesToPush": [
    { "path": "workspace-pm/SOUL.md", "action": "update", "sizeBytes": 2048 }
  ],
  "conflicts": [],
  "requiresRestart": false,
  "estimatedDurationMs": 5000
}
```

### Push to Remote

`POST /api/machines/:machineId/sync/push`

Body (optional):
```json
{
  "files": ["workspace-pm/SOUL.md"],
  "forceSyncMode": "warm",
  "skipVerification": false
}
```

If `files` is omitted, pushes all `local_dirty = true` files.

Response:
```json
{
  "operationId": "uuid",
  "status": "completed",
  "syncMode": "hot",
  "syncedFiles": 1,
  "failedFiles": 0,
  "gatewayRestarted": false,
  "durationMs": 3200
}
```

### Full Bidirectional Sync

`POST /api/machines/:machineId/sync/full`

Performs pull → conflict check → push → verify.

### List Sync History

`GET /api/machines/:machineId/sync/operations`

Query params: `?status=failed&page=1&pageSize=20`

### Get Sync Operation Detail

`GET /api/sync/operations/:operationId`

Includes per-file status.

### Retry Failed Sync

`POST /api/sync/operations/:operationId/retry`

Re-attempts only the failed files from the original operation.

### Batch Sync (Multi-Machine)

`POST /api/sync/batch`

Body:
```json
{
  "machineIds": ["uuid1", "uuid2", "uuid3"],
  "direction": "push"
}
```

---

## 6. Skills API

### List Skill Catalog

`GET /api/skills`

Query params: `?source=clawhub&scope=global&reviewStatus=approved`

Response:
```json
{
  "data": [
    {
      "id": "uuid",
      "skillKey": "feishu-webhook",
      "name": "Feishu Webhook",
      "description": "Send messages to Feishu groups via webhook",
      "scope": "global",
      "source": "custom",
      "version": "1.0.0",
      "reviewStatus": "approved",
      "createdAt": "2026-03-06T10:00:00Z"
    }
  ],
  "total": 1
}
```

### Get Skill Details

`GET /api/skills/:skillId`

Returns full skill record including `skillMdContent`.

### Add Skill to Catalog

`POST /api/skills`

Body:
```json
{
  "skillKey": "feishu-webhook",
  "name": "Feishu Webhook",
  "description": "Send messages to Feishu groups via webhook",
  "scope": "global",
  "source": "custom",
  "skillMdContent": "---\nname: feishu-webhook\n...",
  "requiresBins": ["curl"],
  "requiresEnv": ["FEISHU_WEBHOOK_URL"]
}
```

### Update Skill

`PATCH /api/skills/:skillId`

Body (all fields optional):
```json
{
  "name": "Updated Name",
  "description": "Updated description",
  "version": "1.1.0",
  "skillMdContent": "---\nname: Updated\n---\n# Content"
}
```

### Delete Skill

`DELETE /api/skills/:skillId`

Returns 204 on success.

### Review Skill (Approve/Reject)

`POST /api/skills/:skillId/review`

Body:
```json
{
  "action": "approve",
  "reviewedBy": "admin"
}
```

Action can be `approve` or `reject`. Updates `review_status`, `reviewed_by`, `reviewed_at`.

### List Agent Skills

`GET /api/agents/:agentId/skills`

Response:
```json
{
  "data": [
    {
      "id": "uuid",
      "agentId": "uuid",
      "skillCatalogId": "uuid",
      "scope": "agent",
      "enabled": true,
      "configOverrides": null,
      "installedAt": "2026-03-06T10:00:00Z",
      "skill": { "id": "uuid", "skillKey": "feishu-webhook", "name": "Feishu Webhook", "..." : "..." }
    }
  ],
  "total": 1
}
```

### Install Skill on Agent

`POST /api/agents/:agentId/skills`

Body:
```json
{
  "skillCatalogId": "uuid",
  "scope": "agent",
  "configOverrides": { "webhookUrl": "https://..." }
}
```

Skill must have `reviewStatus: "approved"` before installation.

### Remove Skill from Agent

`DELETE /api/agents/:agentId/skills/:skillCatalogId`

Returns 204 on success.

### Import Skill from Remote Machine

`POST /api/machines/:machineId/skills/import`

Body:
```json
{
  "skillKey": "morning-standup",
  "scope": "global"
}
```

SSH into the machine, reads `SKILL.md` from `~/.openclaw/skills/{skillKey}/SKILL.md`,
parses frontmatter, and creates/updates the catalog entry.

### Deploy Skill to Machine

`POST /api/skills/:skillId/deploy/:machineId`

Body (optional):
```json
{
  "scope": "global",
  "agentId": "uuid"
}
```

Uploads the skill's `SKILL.md` to the target machine.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `scope` | `"global"` \| `"agent"` | `"global"` | Deploy to node-level or agent-level skills |
| `agentId` | UUID (optional) | — | Required when `scope` is `"agent"`. Determines the agent workspace directory. |

Deploy paths:
- `scope: "global"` → `~/.openclaw/skills/{skillKey}/`
- `scope: "agent"` + `agentId` → `~/.openclaw/{workspacePath}/skills/{skillKey}/`

---

## 7. Credentials API

### List Credentials

`GET /api/credentials`

Query params: `?machineId=uuid&provider=anthropic`

Note: Credential values are NEVER returned in list/get responses.
Only metadata (id, name, type, provider, targetFilePath) is returned.

Response:
```json
{
  "data": [
    {
      "id": "uuid",
      "machineId": "uuid",
      "name": "Anthropic API Key",
      "credentialType": "api_key",
      "provider": "anthropic",
      "targetFilePath": "credentials/anthropic.json",
      "description": "Main API key for Anthropic",
      "createdAt": "2026-03-06T10:00:00Z",
      "updatedAt": "2026-03-06T10:00:00Z"
    }
  ],
  "total": 1
}
```

### Get Credential

`GET /api/credentials/:credentialId`

Returns metadata only (no decrypted value).

### Create Credential

`POST /api/credentials`

Body:
```json
{
  "machineId": "uuid",
  "name": "Anthropic API Key",
  "credentialType": "api_key",
  "provider": "anthropic",
  "value": "sk-ant-...",
  "targetFilePath": "credentials/anthropic.json",
  "description": "Production API key"
}
```

The `value` is encrypted with AES-256-GCM before storage and never returned in responses.
`credentialType` can be: `api_key`, `oauth_token`, `allow_from`, `pairing`, `webhook_secret`, `other`.

### Update Credential

`PATCH /api/credentials/:credentialId`

Body (all fields optional):
```json
{
  "name": "Updated Name",
  "value": "new-secret-value",
  "targetFilePath": "credentials/updated-path.json",
  "description": "Updated description"
}
```

If `value` is provided, the encrypted value is replaced.

### Delete Credential

`DELETE /api/credentials/:credentialId`

Returns 204 on success.

### Sync Single Credential to Machine

`POST /api/credentials/:credentialId/sync/:machineId`

Decrypts the credential value and uploads it to the machine at
`{openclawHome}/{targetFilePath}` with `0o600` permissions.

Response:
```json
{
  "success": true,
  "credentialId": "uuid",
  "machineId": "uuid"
}
```

### Sync All Credentials to Machine

`POST /api/machines/:machineId/credentials/sync-all`

Syncs all credentials associated with the machine (that have `targetFilePath` configured).

Response:
```json
{
  "synced": 3,
  "failed": 0
}
```

---

## 8. Cron API

### List Cron Jobs

`GET /api/machines/:machineId/cron/jobs`

### Create Cron Job

`POST /api/machines/:machineId/cron/jobs`

Body:
```json
{
  "name": "Morning Standup",
  "agentId": "pm",
  "schedule": { "kind": "cron", "expr": "0 9 * * 1-5", "tz": "Asia/Shanghai" },
  "sessionTarget": "isolated",
  "wakeMode": "now",
  "payload": { "kind": "agentTurn", "message": "Run the morning standup skill" },
  "enabled": true
}
```

### Update Cron Job

`PUT /api/machines/:machineId/cron/jobs/:jobId`

### Delete Cron Job

`DELETE /api/machines/:machineId/cron/jobs/:jobId`

---

## 9. Playground

### 9.1 Sessions

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/playground/sessions` | Create a test session |
| `GET` | `/api/playground/sessions` | List test sessions |
| `GET` | `/api/playground/sessions/:sessionId` | Get session details |
| `DELETE` | `/api/playground/sessions/:sessionId` | Delete session |
| `POST` | `/api/playground/sessions/:sessionId/chat` | Send message (SSE stream) |
| `POST` | `/api/playground/sessions/:sessionId/stop` | Stop active session |

#### Create Session

```bash
POST /api/playground/sessions
```

```json
{
  "skillCatalogId": "uuid (optional, links to existing skill)",
  "skillMdContent": "---\nname: my-skill\n---\nSkill instructions...",
  "config": {
    "model": "claude-sonnet-4-20250514",
    "maxToolCalls": 50,
    "timeoutSeconds": 300,
    "allowedTools": ["read_file", "write_file"]
  }
}
```

#### Chat (SSE)

```bash
POST /api/playground/sessions/:sessionId/chat
Content-Type: application/json
```

```json
{ "message": "Hello, test this skill" }
```

Returns Server-Sent Events:
- `event: text-delta` — streaming text token
- `event: tool-call-begin` — tool invocation started
- `event: tool-call-result` — tool result
- `event: done` — stream complete
- `event: error` — error occurred

### 9.2 Skill Authoring

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/playground/skills/validate` | Validate SKILL.md content |
| `POST` | `/api/playground/skills/scan` | Run security scan |
| `POST` | `/api/playground/skills/parse` | Parse frontmatter and content |
| `GET` | `/api/playground/templates` | List skill templates |

### 9.3 Skill Versions

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/skills/:skillId/versions` | List version history |
| `POST` | `/api/skills/:skillId/versions` | Save new version |
| `GET` | `/api/skills/:skillId/versions/:versionId` | Get specific version |

---

## 10. WebSocket Events

Connect to `ws://localhost:3000/ws`

Upon connection, the server sends a `connected` event:
```json
{
  "type": "connected",
  "timestamp": "2026-03-06T10:00:00Z",
  "payload": { "message": "ClawConsole WebSocket connected" }
}
```

### Event Types

All events follow this format:
```json
{
  "type": "sync:started",
  "timestamp": "2026-03-06T10:00:00Z",
  "payload": { ... }
}
```

| Event | Payload | Description |
|-------|---------|-------------|
| `sync:started` | `{ operationId, machineId, syncType, direction }` | Sync operation started |
| `sync:progress` | `{ operationId, file, action, status, current, total }` | Per-file progress (includes count) |
| `sync:completed` | `{ operationId, status, syncMode, syncedFiles, failedFiles, durationMs }` | Sync finished |
| `sync:conflict` | `{ operationId, conflicts: [{ path, localHash, remoteHash }] }` | Conflicts detected |
| `machine:status` | `{ machineId, status, checkedAt }` | Machine status change |
| `agent:status` | `{ agentId, status }` | Agent status change |
| `job:health-check` | `{ machineId, results }` | Health check results |

### Architecture

Events are published via Redis Pub/Sub (`clawconsole:events` channel), enabling
multi-instance deployments. The WebSocket server subscribes to this channel and
broadcasts received events to all connected browser clients.
