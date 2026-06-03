/**
 * Mirror of the platform's ``framework/backend/app/services/
 * knowledge_hub_paths.py``. Keep this in lockstep with the Python helper
 * — both sides write/read the same OSS keys for distilled agents.
 */

const ROOT = 'knowledge_hub/v1';

export function objectSegment(value: string): string {
  return encodeURIComponent((value ?? '').trim());
}

export function joinKey(...parts: Array<string | undefined | null>): string {
  return parts
    .filter((p): p is string => Boolean(p && p.trim()))
    .map((p) => p.replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/');
}

export function rootKey(...parts: string[]): string {
  return joinKey(ROOT, ...parts);
}

export function scopePrefix(scopeType: 'agent' | 'shared', scopeId: string): string {
  return rootKey('scopes', scopeType, objectSegment(scopeId));
}

export function agentPrefix(agentKey: string): string {
  return scopePrefix('agent', agentKey);
}

export function agentMemoryRawPrefix(agentKey: string): string {
  return joinKey(agentPrefix(agentKey), 'raw');
}

export function agentMemoryRawKey(agentKey: string, relativePath: string): string {
  return joinKey(agentMemoryRawPrefix(agentKey), relativePath.replace(/^\/+/, ''));
}

export function agentSkillsPrefix(agentKey: string): string {
  return joinKey(agentPrefix(agentKey), 'skills');
}

export function agentSkillPrefix(agentKey: string, skillKey: string): string {
  return joinKey(agentSkillsPrefix(agentKey), objectSegment(skillKey));
}

export function agentSkillFileKey(
  agentKey: string,
  skillKey: string,
  relativePath: string,
): string {
  return joinKey(
    agentSkillPrefix(agentKey, skillKey),
    (relativePath ?? '').replace(/^\/+/, ''),
  );
}

export function agentSkillManifestKey(agentKey: string, skillKey: string): string {
  return joinKey(agentSkillPrefix(agentKey, skillKey), 'manifest.json');
}

export function agentVectorPrefix(agentKey: string): string {
  return joinKey(agentPrefix(agentKey), 'vector');
}

export function agentVectorSqliteKey(agentKey: string): string {
  return joinKey(agentVectorPrefix(agentKey), 'memory.sqlite');
}

export function agentVectorMetaKey(agentKey: string): string {
  return joinKey(agentVectorPrefix(agentKey), 'memory.sqlite.meta.json');
}

/**
 * Per-agent persona folder. Mirrors
 * ``framework/backend/app/services/knowledge_hub_paths.py:agent_persona_*``
 * — the platform reads these blobs back via the same paths.
 *
 *   scopes/agent/<agent_key>/persona/
 *       SOUL.md
 *       USER.md
 *       IDENTITY.md
 *       AGENTS.md
 *       TOOLS.md
 *       manifest.json
 *
 * HEARTBEAT.md / BOOTSTRAP.md are openclaw runtime scaffolding (no
 * mini-claw analogue) and are filtered out at write time by both sides
 * — they MUST never appear here.
 */
export function agentPersonaPrefix(agentKey: string): string {
  return joinKey(agentPrefix(agentKey), 'persona');
}

export function agentPersonaFileKey(agentKey: string, relativePath: string): string {
  return joinKey(agentPersonaPrefix(agentKey), (relativePath ?? '').replace(/^\/+/, ''));
}

export function agentPersonaManifestKey(agentKey: string): string {
  return joinKey(agentPersonaPrefix(agentKey), 'manifest.json');
}

/**
 * Build the canonical Mini-Claw agent_key for a clawconsole agent.
 * Prefers `machineAlias` (human-readable, unique) and falls back to the
 * UUID first segment to stay compatible with legacy machines that
 * haven't been re-aliased yet.
 */
export function slugifyAgentKey(
  machineId: string,
  agentId: string,
  machineAlias?: string,
): string {
  const alias = (machineAlias ?? '').trim().toLowerCase();
  const shortMachine =
    alias || (machineId ?? '').split('-', 1)[0] || 'claw';
  const candidate = `oc-${shortMachine}-${agentId}`
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/(^-+|-+$)/g, '');
  return candidate.slice(0, 64) || 'openclaw-agent';
}
