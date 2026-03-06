import type { ConflictEntry, ConflictStrategy } from './sync.types.js';
import { classifyFile } from '../../shared/file-classifier.js';

export function resolveConflictStrategy(relativePath: string): ConflictStrategy {
  const category = classifyFile(relativePath);

  if (category === 'runtime_observable') return 'remote_wins';

  if (relativePath === 'openclaw.json') return 'local_wins';

  return 'user_decides';
}

export interface ConflictResolution {
  relativePath: string;
  strategy: ConflictStrategy;
  resolvedContent?: string;
}

export function autoResolveConflicts(conflicts: ConflictEntry[]): {
  autoResolved: ConflictResolution[];
  needsUserInput: ConflictEntry[];
} {
  const autoResolved: ConflictResolution[] = [];
  const needsUserInput: ConflictEntry[] = [];

  for (const conflict of conflicts) {
    const strategy = resolveConflictStrategy(conflict.relativePath);

    switch (strategy) {
      case 'local_wins':
        autoResolved.push({
          relativePath: conflict.relativePath,
          strategy: 'local_wins',
          resolvedContent: conflict.localContent,
        });
        break;

      case 'remote_wins':
        autoResolved.push({
          relativePath: conflict.relativePath,
          strategy: 'remote_wins',
        });
        break;

      case 'user_decides':
        needsUserInput.push(conflict);
        break;
    }
  }

  return { autoResolved, needsUserInput };
}
