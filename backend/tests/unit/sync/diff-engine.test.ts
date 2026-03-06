import { describe, it, expect } from 'vitest';
import { DiffEngine } from '../../../src/modules/sync/diff-engine.js';
import type { RemoteManifest, LocalFileState } from '../../../src/modules/sync/sync.types.js';

describe('DiffEngine', () => {
  const engine = new DiffEngine();

  function makeManifest(entries: Array<{ path: string; hash: string }>): RemoteManifest {
    return {
      machineId: 'test-machine',
      collectedAt: new Date(),
      entries: entries.map((e) => ({
        relativePath: e.path,
        hash: e.hash,
        size: 100,
        mtime: Date.now(),
      })),
    };
  }

  function makeLocalFile(
    path: string,
    opts: { contentHash?: string; remoteHash?: string; localDirty?: boolean } = {},
  ): LocalFileState {
    return {
      id: `file-${path}`,
      relativePath: path,
      contentHash: opts.contentHash ?? 'local-hash-' + path,
      remoteHash: opts.remoteHash ?? 'remote-hash-' + path,
      localDirty: opts.localDirty ?? false,
      content: `content of ${path}`,
    };
  }

  it('detects new remote files', () => {
    const localFiles: LocalFileState[] = [];
    const manifest = makeManifest([
      { path: 'workspace-pm/SOUL.md', hash: 'abc123' },
    ]);

    const diff = engine.computeDiff(localFiles, manifest);

    expect(diff.remoteNew).toHaveLength(1);
    expect(diff.remoteNew[0].relativePath).toBe('workspace-pm/SOUL.md');
    expect(diff.remoteModified).toHaveLength(0);
    expect(diff.conflicts).toHaveLength(0);
  });

  it('detects modified remote files', () => {
    const localFiles = [
      makeLocalFile('workspace-pm/SOUL.md', { remoteHash: 'old-hash' }),
    ];
    const manifest = makeManifest([
      { path: 'workspace-pm/SOUL.md', hash: 'new-hash' },
    ]);

    const diff = engine.computeDiff(localFiles, manifest);

    expect(diff.remoteModified).toHaveLength(1);
    expect(diff.remoteModified[0].hash).toBe('new-hash');
    expect(diff.conflicts).toHaveLength(0);
  });

  it('detects conflicts when both local and remote changed', () => {
    const localFiles = [
      makeLocalFile('workspace-pm/SOUL.md', {
        remoteHash: 'old-hash',
        localDirty: true,
        contentHash: 'local-edited-hash',
      }),
    ];
    const manifest = makeManifest([
      { path: 'workspace-pm/SOUL.md', hash: 'new-remote-hash' },
    ]);

    const diff = engine.computeDiff(localFiles, manifest);

    expect(diff.conflicts).toHaveLength(1);
    expect(diff.conflicts[0].localHash).toBe('local-edited-hash');
    expect(diff.conflicts[0].remoteHash).toBe('new-remote-hash');
    expect(diff.remoteModified).toHaveLength(0);
  });

  it('detects deleted remote files', () => {
    const localFiles = [
      makeLocalFile('workspace-pm/SOUL.md', { remoteHash: 'some-hash' }),
    ];
    const manifest = makeManifest([]);

    const diff = engine.computeDiff(localFiles, manifest);

    expect(diff.remoteDeleted).toHaveLength(1);
    expect(diff.remoteDeleted[0]).toBe('workspace-pm/SOUL.md');
  });

  it('identifies unchanged files', () => {
    const localFiles = [
      makeLocalFile('workspace-pm/SOUL.md', { remoteHash: 'same-hash' }),
    ];
    const manifest = makeManifest([
      { path: 'workspace-pm/SOUL.md', hash: 'same-hash' },
    ]);

    const diff = engine.computeDiff(localFiles, manifest);

    expect(diff.unchanged).toHaveLength(1);
    expect(diff.remoteNew).toHaveLength(0);
    expect(diff.remoteModified).toHaveLength(0);
    expect(diff.conflicts).toHaveLength(0);
  });

  it('identifies local dirty files ready to push', () => {
    const localFiles = [
      makeLocalFile('workspace-pm/SOUL.md', {
        remoteHash: 'same-hash',
        localDirty: true,
      }),
    ];
    const manifest = makeManifest([
      { path: 'workspace-pm/SOUL.md', hash: 'same-hash' },
    ]);

    const diff = engine.computeDiff(localFiles, manifest);

    expect(diff.localDirty).toHaveLength(1);
    expect(diff.conflicts).toHaveLength(0);
  });

  it('handles complex mixed scenario', () => {
    const localFiles = [
      makeLocalFile('openclaw.json', { remoteHash: 'config-old' }),
      makeLocalFile('workspace-pm/SOUL.md', { remoteHash: 'soul-same' }),
      makeLocalFile('workspace-pm/AGENTS.md', { remoteHash: 'agents-old', localDirty: true }),
      makeLocalFile('skills/old-skill/SKILL.md', { remoteHash: 'old-skill-hash' }),
    ];
    const manifest = makeManifest([
      { path: 'openclaw.json', hash: 'config-new' },
      { path: 'workspace-pm/SOUL.md', hash: 'soul-same' },
      { path: 'workspace-pm/AGENTS.md', hash: 'agents-new' },
      { path: 'workspace-pm/TOOLS.md', hash: 'tools-new' },
    ]);

    const diff = engine.computeDiff(localFiles, manifest);

    expect(diff.remoteModified).toHaveLength(1);
    expect(diff.remoteModified[0].relativePath).toBe('openclaw.json');

    expect(diff.remoteNew).toHaveLength(1);
    expect(diff.remoteNew[0].relativePath).toBe('workspace-pm/TOOLS.md');

    expect(diff.conflicts).toHaveLength(1);
    expect(diff.conflicts[0].relativePath).toBe('workspace-pm/AGENTS.md');

    expect(diff.remoteDeleted).toHaveLength(1);
    expect(diff.remoteDeleted[0]).toBe('skills/old-skill/SKILL.md');

    expect(diff.unchanged).toHaveLength(1);
    expect(diff.unchanged[0]).toBe('workspace-pm/SOUL.md');
  });
});
