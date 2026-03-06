import type { SyncMode } from './sync.types.js';

const HOT_PATTERNS: RegExp[] = [
  /^workspace(-[^/]+)?\/(SOUL|IDENTITY|USER|AGENTS|TOOLS|BOOTSTRAP|HEARTBEAT|README)\.md$/,
  /^workspace(-[^/]+)?\/skills\/[^/]+\/SKILL\.md$/,
  /^skills\/[^/]+\/SKILL\.md$/,
  /^workspace(-[^/]+)?\/config\/.*\.json$/,
];

const WARM_TRIGGERS: (string | RegExp)[] = [
  'openclaw.json',
  /^credentials\//,
  /^cron\/jobs\.json$/,
  /^hooks\//,
  /^workspace(-[^/]+)?\/skills\/[^/]+\/install\.sh$/,
  /^skills\/[^/]+\/install\.sh$/,
];

export function detectSyncMode(filesToPush: string[]): SyncMode {
  if (filesToPush.length === 0) return 'hot';

  const hasWarmTrigger = filesToPush.some((f) =>
    WARM_TRIGGERS.some((t) => (typeof t === 'string' ? f === t : t.test(f))),
  );

  if (hasWarmTrigger) return 'warm';

  const allHot = filesToPush.every((f) => HOT_PATTERNS.some((p) => p.test(f)));
  return allHot ? 'hot' : 'warm';
}

export function requiresGatewayRestart(mode: SyncMode): boolean {
  return mode === 'warm' || mode === 'cold';
}
