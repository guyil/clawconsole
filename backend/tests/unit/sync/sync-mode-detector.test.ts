import { describe, it, expect } from 'vitest';
import { detectSyncMode, requiresGatewayRestart } from '../../../src/modules/sync/sync-mode-detector.js';

describe('detectSyncMode', () => {
  it('returns hot for empty push set', () => {
    expect(detectSyncMode([])).toBe('hot');
  });

  it('returns hot for workspace .md files only', () => {
    expect(detectSyncMode(['workspace-pm/SOUL.md'])).toBe('hot');
    expect(detectSyncMode([
      'workspace-pm/SOUL.md',
      'workspace-pm/AGENTS.md',
      'workspace-pm/TOOLS.md',
    ])).toBe('hot');
  });

  it('returns hot for existing skill SKILL.md changes', () => {
    expect(detectSyncMode(['workspace-pm/skills/board-query/SKILL.md'])).toBe('hot');
    expect(detectSyncMode(['skills/amazon-scraper/SKILL.md'])).toBe('hot');
  });

  it('returns hot for workspace config json changes', () => {
    expect(detectSyncMode(['workspace-pm/config/api.json'])).toBe('hot');
  });

  it('returns warm when openclaw.json changes', () => {
    expect(detectSyncMode(['openclaw.json'])).toBe('warm');
    expect(detectSyncMode(['workspace-pm/SOUL.md', 'openclaw.json'])).toBe('warm');
  });

  it('returns warm when credentials change', () => {
    expect(detectSyncMode(['credentials/feishu-pm-allowFrom.json'])).toBe('warm');
  });

  it('returns warm when cron/jobs.json changes', () => {
    expect(detectSyncMode(['cron/jobs.json'])).toBe('warm');
  });

  it('returns warm when hooks change', () => {
    expect(detectSyncMode(['hooks/self-improvement/handler.ts'])).toBe('warm');
  });

  it('returns warm for install.sh changes', () => {
    expect(detectSyncMode(['workspace-pm/skills/board-query/install.sh'])).toBe('warm');
    expect(detectSyncMode(['skills/amazon-scraper/install.sh'])).toBe('warm');
  });

  it('returns warm for non-hot-pattern files', () => {
    expect(detectSyncMode(['workspace-pm/some-other-file.txt'])).toBe('warm');
  });
});

describe('requiresGatewayRestart', () => {
  it('hot does not require restart', () => {
    expect(requiresGatewayRestart('hot')).toBe(false);
  });

  it('warm requires restart', () => {
    expect(requiresGatewayRestart('warm')).toBe(true);
  });

  it('cold requires restart', () => {
    expect(requiresGatewayRestart('cold')).toBe(true);
  });
});
