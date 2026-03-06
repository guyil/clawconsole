import type { ManifestEntry } from '../modules/sync/sync.types.js';

export function parseManifestOutput(output: string): ManifestEntry[] {
  const entries: ManifestEntry[] = [];

  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const parts = trimmed.split('|');
    if (parts.length < 4) continue;

    const relativePath = parts[0].replace(/^\.\//, '');
    const hash = parts[1];
    const size = parseInt(parts[2], 10);
    const mtime = parseInt(parts[3], 10);

    if (!hash || hash.length !== 64) continue;
    if (isNaN(size) || isNaN(mtime)) continue;

    entries.push({ relativePath, hash, size, mtime });
  }

  return entries;
}
