# ClawConsole — File Classification Reference

> Version: 1.0 | Last Updated: 2026-03-06

This document is the definitive reference for how every file under `~/.openclaw/`
is classified for sync purposes. The Sync Engine uses this classification to determine
what to sync, in which direction, and how to handle conflicts.

---

## Classification Categories

| Category | Sync Direction | Console Role | Description |
|----------|---------------|--------------|-------------|
| **A: Console-Managed** | Push (Console → Remote) | Source of truth | Console generates/edits and pushes to remote |
| **B: Runtime-Observable** | Pull (Remote → Console) | Read-only observer | Console reads for monitoring, never writes |
| **C: System-Internal** | None | Ignore | Machine-specific or OpenClaw internal files |
| **D: Bidirectional** | Both | Conflict-aware | Category A files that agents may also modify |

---

## Category A: Console-Managed Files

### Machine-Level (Shared by all agents)

| Path | Type | Notes |
|------|------|-------|
| `openclaw.json` | config | Central config: agents, channels, bindings, skills, models, cron, hooks, gateway. JSON5 format. |
| `skills/*/SKILL.md` | skill | Global shared skill definitions. YAML frontmatter + Markdown. |
| `skills/*/install.sh` | skill | Skill installation scripts |
| `skills/*/template.*` | skill | Skill template files |
| `hooks/*/HOOK.md` | hook | Custom hook definitions |
| `hooks/*/handler.ts` | hook | Custom hook handler code |
| `cron/jobs.json` | cron | Scheduled job definitions |
| `credentials/*-allowFrom.json` | credential | Channel message allowlists per agent |
| `credentials/*-pairing.json` | credential | Channel pairing state |

### Agent-Level (Per workspace-{agentId})

| Path | Type | Notes |
|------|------|-------|
| `workspace-{id}/SOUL.md` | persona | Agent core personality and behavior rules |
| `workspace-{id}/IDENTITY.md` | persona | Agent identity (name, avatar description) |
| `workspace-{id}/USER.md` | persona | User/boss context information |
| `workspace-{id}/AGENTS.md` | persona | Multi-agent collaboration definitions |
| `workspace-{id}/TOOLS.md` | persona | Tool usage notes and device nicknames |
| `workspace-{id}/BOOTSTRAP.md` | persona | Startup loading instructions |
| `workspace-{id}/HEARTBEAT.md` | persona | Heartbeat task checklist |
| `workspace-{id}/README.md` | persona | Agent overview documentation |
| `workspace-{id}/skills/*/SKILL.md` | skill | Agent-specific skill definitions |
| `workspace-{id}/skills/*/install.sh` | skill | Agent-specific skill install scripts |
| `workspace-{id}/skills/*/**` | skill | Agent-specific skill auxiliary files |
| `workspace-{id}/config/*.json` | config | Agent-specific configuration files |

---

## Category B: Runtime-Observable Files

These files are generated and maintained by OpenClaw at runtime.
Console pulls them for monitoring and display purposes only.

### Session Data

| Path | Type | Notes |
|------|------|-------|
| `agents/{id}/sessions/sessions.json` | session | Session state index (all sessions for this agent) |
| `agents/{id}/sessions/*.jsonl` | session | Individual conversation logs (JSON lines) |
| `agents/{id}/agent/auth-profiles.json` | config | LLM authentication profiles (provider, model, lastUsed) |
| `agents/{id}/agent/models.json` | config | Available models list |

### Memory

| Path | Type | Notes |
|------|------|-------|
| `memory/*.sqlite` | memory | Structured agent memory (SQLite). Binary, not synced as blob. |
| `workspace-{id}/memory/*.md` | memory | Daily memory logs (date-stamped markdown) |
| `workspace-{id}/memory/*-*.md` | memory | Session context snapshots |

### Logs

| Path | Type | Notes |
|------|------|-------|
| `logs/gateway.log` | log | Gateway runtime log |
| `logs/gateway.err.log` | log | Gateway error log |
| `logs/commands.log` | log | CLI command history |
| `logs/config-audit.jsonl` | log | Configuration change audit trail |

### Runtime State

| Path | Type | Notes |
|------|------|-------|
| `cron/runs/**` | cron | Cron job execution history |
| `subagents/runs.json` | runtime | Sub-agent run tracking |
| `delivery-queue/**` | runtime | Message delivery queue |
| `delivery-queue/failed/**` | runtime | Failed message deliveries |
| `feishu/dedup/*.json` | runtime | Feishu message dedup per account |
| `devices/paired.json` | runtime | Paired device list |
| `devices/pending.json` | runtime | Pending device pairings |

---

## Category C: System-Internal Files

Console never reads or writes these. They are machine-specific or OpenClaw internals.

| Path | Reason |
|------|--------|
| `identity/device.json` | Machine-unique cryptographic identity |
| `identity/device-auth.json` | Machine-unique auth tokens |
| `update-check.json` | Version check metadata |
| `openclaw.json.bak*` | Auto-backup files |
| `workspace-{id}/.git/**` | Workspace git history |
| `workspace-{id}/.openclaw/workspace-state.json` | Workspace onboarding state |
| `completions/**` | Shell auto-completion scripts |
| `browser/**` | Browser tool data |
| `canvas/**` | Canvas UI assets |

---

## Category D: Bidirectional Concern

These are Category A files that may also be modified by the agent at runtime
(e.g., through self-improvement hooks or agent-initiated file edits).

| File | Why it might change remotely |
|------|----------------------------|
| `workspace-{id}/SOUL.md` | Self-improving agent hook modifies persona |
| `workspace-{id}/HEARTBEAT.md` | Agent adds new heartbeat tasks |
| `workspace-{id}/TOOLS.md` | Agent discovers new tools and updates notes |
| `workspace-{id}/skills/*/SKILL.md` | Agent modifies its own skill definitions |
| `cron/jobs.json` | Agent creates/modifies cron jobs at runtime |

### Conflict Resolution for Category D

When Console detects that a Category D file has been modified both locally and remotely:

1. The pull phase downloads the remote version
2. The diff engine marks the file as `conflict`
3. The API returns the conflict to the frontend
4. The user sees a side-by-side diff and chooses:
   - **Keep Console version** → push overwrites remote
   - **Use Remote version** → discard Console edits, use remote
   - **Edit manually** → user merges changes, then push

---

## Pattern Matching Implementation

```typescript
// file-classifier.ts

const CONSOLE_MANAGED_PATTERNS = [
  /^openclaw\.json$/,
  /^workspace-[^/]+\/(SOUL|IDENTITY|USER|AGENTS|TOOLS|BOOTSTRAP|HEARTBEAT|README)\.md$/,
  /^workspace-[^/]+\/skills\/.+/,
  /^workspace-[^/]+\/config\/.+/,
  /^skills\/.+/,
  /^hooks\/.+/,
  /^cron\/jobs\.json$/,
  /^credentials\/.+\.json$/,
];

const RUNTIME_OBSERVABLE_PATTERNS = [
  /^agents\/.+/,
  /^memory\/.+/,
  /^workspace-[^/]+\/memory\/.+/,
  /^logs\/.+/,
  /^cron\/runs\/.+/,
  /^subagents\/.+/,
  /^delivery-queue\/.+/,
  /^feishu\/.+/,
  /^devices\/.+/,
];

const SYSTEM_INTERNAL_PATTERNS = [
  /^identity\/.+/,
  /^update-check\.json$/,
  /^openclaw\.json\.bak/,
  /^workspace-[^/]+\/\.git\/.+/,
  /^workspace-[^/]+\/\.openclaw\/.+/,
  /^completions\/.+/,
  /^browser\/.+/,
  /^canvas\/.+/,
];

export function classifyFile(relativePath: string): FileCategory {
  // Normalize: strip leading ./
  const normalized = relativePath.replace(/^\.\//, '');

  if (SYSTEM_INTERNAL_PATTERNS.some(p => p.test(normalized))) return 'system_internal';
  if (RUNTIME_OBSERVABLE_PATTERNS.some(p => p.test(normalized))) return 'runtime_observable';
  if (CONSOLE_MANAGED_PATTERNS.some(p => p.test(normalized))) return 'console_managed';
  return 'system_internal'; // Unknown files: don't touch
}

export type FileCategory = 'console_managed' | 'runtime_observable' | 'system_internal';
```
