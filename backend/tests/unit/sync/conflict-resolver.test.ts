import { describe, it, expect } from 'vitest';
import {
  resolveConflictStrategy,
  autoResolveConflicts,
} from '../../../src/modules/sync/conflict-resolver.js';
import type { ConflictEntry } from '../../../src/modules/sync/sync.types.js';

describe('resolveConflictStrategy', () => {
  it('returns local_wins for openclaw.json', () => {
    expect(resolveConflictStrategy('openclaw.json')).toBe('local_wins');
  });

  it('returns remote_wins for runtime observable files', () => {
    expect(resolveConflictStrategy('agents/pm/sessions/sessions.json')).toBe('remote_wins');
    expect(resolveConflictStrategy('logs/gateway.log')).toBe('remote_wins');
    expect(resolveConflictStrategy('memory/pm.sqlite')).toBe('remote_wins');
  });

  it('returns user_decides for workspace persona files', () => {
    expect(resolveConflictStrategy('workspace-pm/SOUL.md')).toBe('user_decides');
    expect(resolveConflictStrategy('workspace-pm/AGENTS.md')).toBe('user_decides');
  });

  it('returns user_decides for skill files', () => {
    expect(resolveConflictStrategy('workspace-pm/skills/test/SKILL.md')).toBe('user_decides');
    expect(resolveConflictStrategy('skills/test/SKILL.md')).toBe('user_decides');
  });
});

describe('autoResolveConflicts', () => {
  function makeConflict(path: string): ConflictEntry {
    return {
      relativePath: path,
      fileId: `file-${path}`,
      localContent: 'local content',
      localHash: 'local-hash',
      remoteHash: 'remote-hash',
      lastKnownRemoteHash: 'old-hash',
    };
  }

  it('auto-resolves openclaw.json with local_wins', () => {
    const conflicts = [makeConflict('openclaw.json')];
    const { autoResolved, needsUserInput } = autoResolveConflicts(conflicts);

    expect(autoResolved).toHaveLength(1);
    expect(autoResolved[0].strategy).toBe('local_wins');
    expect(needsUserInput).toHaveLength(0);
  });

  it('auto-resolves runtime files with remote_wins', () => {
    const conflicts = [makeConflict('agents/pm/sessions/sessions.json')];
    const { autoResolved, needsUserInput } = autoResolveConflicts(conflicts);

    expect(autoResolved).toHaveLength(1);
    expect(autoResolved[0].strategy).toBe('remote_wins');
    expect(needsUserInput).toHaveLength(0);
  });

  it('defers persona files to user', () => {
    const conflicts = [makeConflict('workspace-pm/SOUL.md')];
    const { autoResolved, needsUserInput } = autoResolveConflicts(conflicts);

    expect(autoResolved).toHaveLength(0);
    expect(needsUserInput).toHaveLength(1);
  });

  it('handles mixed conflicts correctly', () => {
    const conflicts = [
      makeConflict('openclaw.json'),
      makeConflict('workspace-pm/SOUL.md'),
      makeConflict('agents/pm/agent/auth-profiles.json'),
      makeConflict('workspace-pm/skills/test/SKILL.md'),
    ];
    const { autoResolved, needsUserInput } = autoResolveConflicts(conflicts);

    expect(autoResolved).toHaveLength(2);
    expect(needsUserInput).toHaveLength(2);
    expect(needsUserInput.map((c) => c.relativePath)).toEqual([
      'workspace-pm/SOUL.md',
      'workspace-pm/skills/test/SKILL.md',
    ]);
  });
});
