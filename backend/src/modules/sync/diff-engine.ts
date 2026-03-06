import type {
  ManifestEntry,
  RemoteManifest,
  DiffResult,
  LocalFileState,
} from './sync.types.js';
import { createChildLogger } from '../../shared/logger.js';

const log = createChildLogger('diff-engine');

export class DiffEngine {
  computeDiff(
    localFiles: LocalFileState[],
    manifest: RemoteManifest,
  ): DiffResult {
    const localMap = new Map<string, LocalFileState>();
    for (const f of localFiles) {
      localMap.set(f.relativePath, f);
    }

    const remoteMap = new Map<string, ManifestEntry>();
    for (const entry of manifest.entries) {
      remoteMap.set(entry.relativePath, entry);
    }

    const result: DiffResult = {
      remoteNew: [],
      remoteModified: [],
      remoteDeleted: [],
      localDirty: [],
      conflicts: [],
      unchanged: [],
    };

    for (const [path, remoteEntry] of remoteMap) {
      const local = localMap.get(path);

      if (!local) {
        result.remoteNew.push(remoteEntry);
        continue;
      }

      if (remoteEntry.hash !== local.remoteHash) {
        if (local.localDirty) {
          result.conflicts.push({
            relativePath: path,
            fileId: local.id,
            localContent: local.content ?? '',
            localHash: local.contentHash ?? '',
            remoteHash: remoteEntry.hash,
            lastKnownRemoteHash: local.remoteHash ?? '',
          });
        } else {
          result.remoteModified.push(remoteEntry);
        }
      } else {
        result.unchanged.push(path);
      }
    }

    for (const [path, local] of localMap) {
      if (!remoteMap.has(path) && local.remoteHash) {
        result.remoteDeleted.push(path);
      }

      if (local.localDirty && !result.conflicts.some((c) => c.relativePath === path)) {
        result.localDirty.push({
          id: local.id,
          relativePath: path,
          contentHash: local.contentHash ?? '',
          content: local.content ?? '',
        });
      }
    }

    log.info({
      remoteNew: result.remoteNew.length,
      remoteModified: result.remoteModified.length,
      remoteDeleted: result.remoteDeleted.length,
      localDirty: result.localDirty.length,
      conflicts: result.conflicts.length,
      unchanged: result.unchanged.length,
    }, 'Diff computed');

    return result;
  }
}
