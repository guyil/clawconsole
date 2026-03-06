import { describe, it, expect } from 'vitest';
import {
  classifyFile,
  detectFileType,
  extractAgentId,
  isExcludedFromSync,
} from '../../../src/shared/file-classifier.js';

describe('classifyFile', () => {
  it('classifies openclaw.json as console_managed', () => {
    expect(classifyFile('openclaw.json')).toBe('console_managed');
    expect(classifyFile('./openclaw.json')).toBe('console_managed');
  });

  it('classifies workspace persona files as console_managed', () => {
    expect(classifyFile('workspace-pm/SOUL.md')).toBe('console_managed');
    expect(classifyFile('workspace-brand_manager/AGENTS.md')).toBe('console_managed');
    expect(classifyFile('workspace/TOOLS.md')).toBe('console_managed');
    expect(classifyFile('workspace-pm/HEARTBEAT.md')).toBe('console_managed');
    expect(classifyFile('workspace-pm/IDENTITY.md')).toBe('console_managed');
    expect(classifyFile('workspace-pm/USER.md')).toBe('console_managed');
    expect(classifyFile('workspace-pm/BOOTSTRAP.md')).toBe('console_managed');
    expect(classifyFile('workspace-pm/README.md')).toBe('console_managed');
  });

  it('classifies workspace skills as console_managed', () => {
    expect(classifyFile('workspace-pm/skills/morning-standup/SKILL.md')).toBe('console_managed');
    expect(classifyFile('skills/amazon-scraper/SKILL.md')).toBe('console_managed');
  });

  it('classifies hooks as console_managed', () => {
    expect(classifyFile('hooks/self-improvement/HOOK.md')).toBe('console_managed');
    expect(classifyFile('hooks/self-improvement/handler.ts')).toBe('console_managed');
  });

  it('classifies cron jobs.json as console_managed', () => {
    expect(classifyFile('cron/jobs.json')).toBe('console_managed');
  });

  it('classifies credentials as console_managed', () => {
    expect(classifyFile('credentials/feishu-pm-allowFrom.json')).toBe('console_managed');
    expect(classifyFile('credentials/feishu-pairing.json')).toBe('console_managed');
  });

  it('classifies agent sessions as runtime_observable', () => {
    expect(classifyFile('agents/pm/sessions/sessions.json')).toBe('runtime_observable');
    expect(classifyFile('agents/pm/agent/auth-profiles.json')).toBe('runtime_observable');
  });

  it('classifies memory files as runtime_observable', () => {
    expect(classifyFile('workspace-pm/memory/2026-03-05.md')).toBe('runtime_observable');
    expect(classifyFile('memory/pm.sqlite')).toBe('runtime_observable');
  });

  it('classifies logs as runtime_observable', () => {
    expect(classifyFile('logs/gateway.log')).toBe('runtime_observable');
    expect(classifyFile('logs/config-audit.jsonl')).toBe('runtime_observable');
  });

  it('classifies runtime state as runtime_observable', () => {
    expect(classifyFile('delivery-queue/failed/msg1.json')).toBe('runtime_observable');
    expect(classifyFile('feishu/dedup/pm.json')).toBe('runtime_observable');
    expect(classifyFile('subagents/runs.json')).toBe('runtime_observable');
    expect(classifyFile('devices/paired.json')).toBe('runtime_observable');
  });

  it('classifies system internal files', () => {
    expect(classifyFile('identity/device.json')).toBe('system_internal');
    expect(classifyFile('identity/device-auth.json')).toBe('system_internal');
    expect(classifyFile('update-check.json')).toBe('system_internal');
    expect(classifyFile('openclaw.json.bak.2026-03-05')).toBe('system_internal');
    expect(classifyFile('workspace-pm/.git/config')).toBe('system_internal');
    expect(classifyFile('workspace-pm/.openclaw/workspace-state.json')).toBe('system_internal');
    expect(classifyFile('completions/openclaw.zsh')).toBe('system_internal');
    expect(classifyFile('browser/openclaw/data')).toBe('system_internal');
    expect(classifyFile('canvas/index.html')).toBe('system_internal');
  });

  it('classifies unknown files as system_internal (safe default)', () => {
    expect(classifyFile('some-random-file.txt')).toBe('system_internal');
  });
});

describe('detectFileType', () => {
  it('detects config type', () => {
    expect(detectFileType('openclaw.json')).toBe('config');
    expect(detectFileType('workspace-pm/config/api.json')).toBe('config');
  });

  it('detects persona type', () => {
    expect(detectFileType('workspace-pm/SOUL.md')).toBe('persona');
    expect(detectFileType('workspace/AGENTS.md')).toBe('persona');
  });

  it('detects skill type', () => {
    expect(detectFileType('skills/amazon-scraper/SKILL.md')).toBe('skill');
    expect(detectFileType('workspace-pm/skills/board-query/SKILL.md')).toBe('skill');
  });

  it('detects credential type', () => {
    expect(detectFileType('credentials/feishu-pm-allowFrom.json')).toBe('credential');
  });

  it('detects cron type', () => {
    expect(detectFileType('cron/jobs.json')).toBe('cron');
  });

  it('detects hook type', () => {
    expect(detectFileType('hooks/self-improvement/HOOK.md')).toBe('hook');
  });

  it('detects log type', () => {
    expect(detectFileType('logs/gateway.log')).toBe('log');
  });

  it('detects memory type', () => {
    expect(detectFileType('workspace-pm/memory/2026-03-05.md')).toBe('memory');
    expect(detectFileType('memory/pm.sqlite')).toBe('memory');
  });
});

describe('extractAgentId', () => {
  it('extracts agent ID from workspace path', () => {
    expect(extractAgentId('workspace-pm/SOUL.md')).toBe('pm');
    expect(extractAgentId('workspace-brand_manager/skills/test/SKILL.md')).toBe('brand_manager');
  });

  it('extracts main agent from default workspace', () => {
    expect(extractAgentId('workspace/SOUL.md')).toBe('main');
  });

  it('extracts agent ID from agents directory', () => {
    expect(extractAgentId('agents/pm/sessions/sessions.json')).toBe('pm');
  });

  it('extracts agent ID from memory sqlite', () => {
    expect(extractAgentId('memory/pm.sqlite')).toBe('pm');
  });

  it('returns null for machine-level files', () => {
    expect(extractAgentId('openclaw.json')).toBeNull();
    expect(extractAgentId('skills/amazon-scraper/SKILL.md')).toBeNull();
    expect(extractAgentId('cron/jobs.json')).toBeNull();
  });
});

describe('isExcludedFromSync', () => {
  it('excludes SQLite files', () => {
    expect(isExcludedFromSync('memory/pm.sqlite')).toBe(true);
    expect(isExcludedFromSync('memory/pm.sqlite-wal')).toBe(true);
  });

  it('excludes identity files', () => {
    expect(isExcludedFromSync('identity/device.json')).toBe(true);
  });

  it('excludes git files', () => {
    expect(isExcludedFromSync('workspace-pm/.git/config')).toBe(true);
  });

  it('does not exclude managed files', () => {
    expect(isExcludedFromSync('workspace-pm/SOUL.md')).toBe(false);
    expect(isExcludedFromSync('openclaw.json')).toBe(false);
  });
});
