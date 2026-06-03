/**
 * sync-bot-names-from-soul.ts — backfill ``agents.name`` from each bot's SOUL.md
 *
 * Every bot's SOUL.md opens with an H1 line like:
 *
 *   # SOUL.md — 首席项目经理（Chief PM）
 *   # Soul - 产品老大
 *   # SOUL.md — 艾宝 (CAIO) | 首席 AI 官
 *
 * This script walks every agent in ``clawconsole.agents``, parses that H1
 * line, and (with ``--apply``) writes the extracted display name into
 * ``agents.name``. Source-of-truth order:
 *
 *   1. ``managed_files`` cache (fast, no SSH, works in the cloud where
 *      bot-machine SSH may not be reachable)
 *   2. ``--ssh`` fallback: direct SSH to each online machine and ``cat``
 *      the SOUL.md (only when the cache is stale/empty)
 *
 * Runs standalone via ``tsx`` — no Fastify boot, just MySQL (+ optional
 * SSH). Same script binary works against local and cloud DBs; point the
 * ``MYSQL_*`` env vars at the right database.
 *
 * Usage:
 *   tsx src/scripts/sync-bot-names-from-soul.ts                 # dry run (default)
 *   tsx src/scripts/sync-bot-names-from-soul.ts --apply         # write changes
 *   tsx src/scripts/sync-bot-names-from-soul.ts --apply --ssh   # also SSH-fetch missing SOUL.md
 *   tsx src/scripts/sync-bot-names-from-soul.ts --only-null     # don't overwrite manual names
 *   tsx src/scripts/sync-bot-names-from-soul.ts --machine "Charlie Mac Studio"
 *   tsx src/scripts/sync-bot-names-from-soul.ts --agent project_manager
 */

import { getDb, closeDb } from '../shared/db.js';
import { SSHPool, type SSHConnectionInfo } from '../transport/ssh-pool.js';

interface CliFlags {
  apply: boolean;
  ssh: boolean;
  onlyNull: boolean;
  machineFilter: string | null;
  agentFilter: string | null;
  quiet: boolean;
}

const USAGE = `\
sync-bot-names-from-soul.ts — backfill agents.name from SOUL.md

Usage:
  tsx src/scripts/sync-bot-names-from-soul.ts [options]

Options:
  --apply            Actually write to DB (default: dry-run, prints diff only)
  --ssh              Fall back to SSH cat for bots whose SOUL.md is not in
                     the managed_files cache (slower, requires reachable
                     bot machines; skip in cloud if not networked)
  --only-null        Only fill in names that are currently NULL/empty;
                     never overwrite a manually-set name. Default: SOUL.md
                     is treated as the source of truth and overwrites.
  --machine <name>   Limit to one machine (matches machines.name, case-insensitive)
  --agent <id>       Limit to one agent_id
  --quiet, -q        Print summary only, no per-bot table
  --help, -h         Show this help
`;

function parseArgs(argv: string[]): CliFlags {
  const flags: CliFlags = {
    apply: false,
    ssh: false,
    onlyNull: false,
    machineFilter: null,
    agentFilter: null,
    quiet: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') flags.apply = true;
    else if (a === '--ssh') flags.ssh = true;
    else if (a === '--only-null') flags.onlyNull = true;
    else if (a === '--quiet' || a === '-q') flags.quiet = true;
    else if (a === '--machine') flags.machineFilter = argv[++i] ?? null;
    else if (a === '--agent') flags.agentFilter = argv[++i] ?? null;
    else if (a === '--help' || a === '-h') {
      process.stdout.write(USAGE);
      process.exit(0);
    } else {
      process.stderr.write(`Unknown arg: ${a}\n\n${USAGE}`);
      process.exit(2);
    }
  }
  return flags;
}

/**
 * Headings that are the SOUL.md *template's* section title (e.g. "Who You
 * Are") rather than an actual bot identity. Don't clobber agents.name with
 * any of these — leave the current value alone.
 */
const PLACEHOLDER_NAMES = new Set([
  'who you are',
  'your soul',
  'soul',
  'identity',
  'your identity',
  'bot identity',
]);

/**
 * Parse the first non-empty H1 of a SOUL.md and extract the bot's display
 * name. Returns ``null`` if no recognisable name is found — the caller
 * MUST treat ``null`` as "skip this bot" rather than wiping the column.
 *
 * Examples (input → output):
 *   "# SOUL.md — 首席项目经理（Chief PM）"   → "首席项目经理（Chief PM）"
 *   "# Soul - 产品老大"                         → "产品老大"
 *   "# SOUL.md — 艾宝 (CAIO) | 首席 AI 官"   → "艾宝 (CAIO) | 首席 AI 官"
 *   "# SOUL.md - Who You Are"                  → null (placeholder)
 *   "# Foo Bar"                                → null (no SOUL prefix)
 */
export function extractNameFromSoul(content: string): string | null {
  const lines = content.split(/\r?\n/);
  let header: string | null = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    // Skip YAML frontmatter delimiter
    if (line === '---' && header === null) continue;
    if (line.startsWith('#')) {
      header = line;
      break;
    }
    // First non-empty line is not a heading → no H1 to parse
    return null;
  }
  if (!header) return null;

  let body = header.replace(/^#+\s*/, '').trim();
  if (!body) return null;

  // Strip the "SOUL.md —" / "Soul -" prefix. Accept em-dash, en-dash,
  // hyphen, colon, and the Chinese fullwidth dash variants.
  const prefixMatch = body.match(/^(?:SOUL\.md|Soul)\s*[—–\-:：]\s*(.+)$/i);
  if (prefixMatch) {
    body = prefixMatch[1].trim();
  } else if (/^SOUL\.md$|^Soul$/i.test(body)) {
    // Header is literally "# SOUL.md" with no content after — no name.
    return null;
  }

  body = body.replace(/[\s.;。，；]+$/, '').trim();
  if (!body) return null;

  if (PLACEHOLDER_NAMES.has(body.toLowerCase())) return null;

  return body;
}

interface Plan {
  agentPk: string;
  agentId: string;
  machineName: string;
  currentName: string | null;
  extractedName: string | null;
  source: 'cache' | 'ssh' | 'none';
  note?: string;
}

function printPlanTable(plans: Plan[], flags: CliFlags): void {
  if (flags.quiet) return;
  if (plans.length === 0) {
    console.log('(no bots matched filters)');
    return;
  }

  const rows = plans.map((p) => ({
    machine: p.machineName,
    agent: p.agentId,
    current: p.currentName ?? '(null)',
    next: p.extractedName ?? '—',
    src: p.source,
    note: p.note ?? '',
  }));

  const widths = {
    machine: Math.max(7, ...rows.map((r) => visualWidth(r.machine))),
    agent: Math.max(8, ...rows.map((r) => visualWidth(r.agent))),
    current: Math.max(7, ...rows.map((r) => visualWidth(r.current))),
    next: Math.max(7, ...rows.map((r) => visualWidth(r.next))),
    src: Math.max(5, ...rows.map((r) => visualWidth(r.src))),
    note: Math.max(4, ...rows.map((r) => visualWidth(r.note))),
  };

  const head = [
    pad('machine', widths.machine),
    pad('agent_id', widths.agent),
    pad('current', widths.current),
    pad('→ from SOUL.md', widths.next),
    pad('src', widths.src),
    pad('note', widths.note),
  ].join('  ');
  console.log(head);
  console.log('-'.repeat(head.length));
  for (const r of rows) {
    console.log(
      [
        pad(r.machine, widths.machine),
        pad(r.agent, widths.agent),
        pad(r.current, widths.current),
        pad(r.next, widths.next),
        pad(r.src, widths.src),
        pad(r.note, widths.note),
      ].join('  '),
    );
  }
}

/** Pads with spaces accounting for CJK fullwidth glyphs (2 cols each). */
function pad(s: string, width: number): string {
  const w = visualWidth(s);
  return s + ' '.repeat(Math.max(0, width - w));
}

function visualWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0;
    // CJK Unified Ideographs, Hangul, Hiragana, Katakana, Fullwidth forms…
    if (
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0x9fff) ||
      (code >= 0xa960 && code <= 0xa97f) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe4f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6)
    ) {
      w += 2;
    } else {
      w += 1;
    }
  }
  return w;
}

async function main(): Promise<void> {
  const flags = parseArgs(process.argv.slice(2));
  const db = getDb();

  let query = db('agents as a')
    .join('machines as m', 'a.machine_id', 'm.id')
    .select(
      'a.id as agent_pk',
      'a.agent_id',
      'a.name as agent_name',
      'a.workspace_path',
      'm.id as machine_id',
      'm.name as machine_name',
      'm.tailscale_hostname',
      'm.ssh_user',
      'm.ssh_port',
      'm.ssh_password',
      'm.openclaw_home',
      'm.status as machine_status',
    )
    .orderBy('m.name')
    .orderBy('a.agent_id');

  if (flags.machineFilter) {
    query = query.whereRaw('LOWER(m.name) = LOWER(?)', [flags.machineFilter]);
  }
  if (flags.agentFilter) {
    query = query.where('a.agent_id', flags.agentFilter);
  }

  const agents = (await query) as Array<{
    agent_pk: string;
    agent_id: string;
    agent_name: string | null;
    workspace_path: string | null;
    machine_id: string;
    machine_name: string;
    tailscale_hostname: string;
    ssh_user: string;
    ssh_port: number;
    ssh_password: string | null;
    openclaw_home: string | null;
    machine_status: string;
  }>;

  // Bulk-load whatever SOUL.md content is already in managed_files.
  // (One JOIN, ~50 rows — orders of magnitude cheaper than 50 SSH calls.)
  const cacheRows = (await db('managed_files as mf')
    .join('agents as a', function joinOn() {
      this.on('a.machine_id', '=', 'mf.machine_id').andOn(
        db.raw("CONCAT(a.workspace_path, '/SOUL.md') = mf.relative_path"),
      );
    })
    .whereNotNull('mf.content')
    .select('a.id as agent_pk', 'mf.content')) as Array<{ agent_pk: string; content: string }>;

  const cache = new Map<string, string>();
  for (const r of cacheRows) cache.set(r.agent_pk, r.content);

  const sshPool = flags.ssh ? new SSHPool() : null;
  const plans: Plan[] = [];

  for (const row of agents) {
    let soul = cache.get(row.agent_pk) ?? null;
    let source: Plan['source'] = soul ? 'cache' : 'none';

    if (!soul && sshPool && row.workspace_path) {
      if (row.machine_status !== 'online') {
        plans.push({
          agentPk: row.agent_pk,
          agentId: row.agent_id,
          machineName: row.machine_name,
          currentName: row.agent_name,
          extractedName: null,
          source: 'none',
          note: 'machine offline',
        });
        continue;
      }
      const info: SSHConnectionInfo = {
        machineId: row.machine_id,
        host: row.tailscale_hostname,
        port: row.ssh_port,
        username: row.ssh_user,
        password: row.ssh_password ?? undefined,
      };
      // openclaw_home is stored with a leading ``~`` (e.g. ~/.openclaw);
      // expand it via $HOME inside the remote login shell so ``cat``
      // doesn't choke on the literal tilde when quoted.
      const homePrefix = (row.openclaw_home ?? '~/.openclaw').replace(/^~/, '$HOME');
      const remotePath = `${homePrefix}/${row.workspace_path}/SOUL.md`;
      try {
        const res = await sshPool.executeCommand(
          info,
          `bash -lc 'cat "${remotePath}" 2>/dev/null || true'`,
          { timeoutMs: 15_000, maxStdoutBytes: 1 * 1024 * 1024 },
        );
        if (res.stdout && res.stdout.trim().length > 0) {
          soul = res.stdout;
          source = 'ssh';
        }
      } catch (err) {
        plans.push({
          agentPk: row.agent_pk,
          agentId: row.agent_id,
          machineName: row.machine_name,
          currentName: row.agent_name,
          extractedName: null,
          source: 'none',
          note: `ssh error: ${(err as Error).message.slice(0, 80)}`,
        });
        continue;
      }
    }

    if (!soul) {
      plans.push({
        agentPk: row.agent_pk,
        agentId: row.agent_id,
        machineName: row.machine_name,
        currentName: row.agent_name,
        extractedName: null,
        source: 'none',
        note: flags.ssh ? 'no SOUL.md on remote' : 'not in cache (try --ssh)',
      });
      continue;
    }

    const extracted = extractNameFromSoul(soul);
    plans.push({
      agentPk: row.agent_pk,
      agentId: row.agent_id,
      machineName: row.machine_name,
      currentName: row.agent_name,
      extractedName: extracted,
      source,
      note: extracted ? undefined : 'no parseable H1 name',
    });
  }

  // Categorise.
  const willUpdate: Plan[] = [];
  const noChange: Plan[] = [];
  const skippedProtected: Plan[] = [];
  const unresolved: Plan[] = [];

  for (const p of plans) {
    if (!p.extractedName) {
      unresolved.push(p);
      continue;
    }
    if ((p.currentName ?? '') === p.extractedName) {
      noChange.push({ ...p, note: 'already matches' });
      continue;
    }
    if (flags.onlyNull && p.currentName != null && p.currentName.length > 0) {
      skippedProtected.push({ ...p, note: 'has manual name (--only-null)' });
      continue;
    }
    willUpdate.push(p);
  }

  if (!flags.quiet) {
    if (willUpdate.length > 0) {
      console.log('\n=== Will update ===');
      printPlanTable(willUpdate, flags);
    }
    if (skippedProtected.length > 0) {
      console.log('\n=== Skipped (manual name protected) ===');
      printPlanTable(skippedProtected, flags);
    }
    if (unresolved.length > 0) {
      console.log('\n=== Unresolved (no SOUL.md or unparseable) ===');
      printPlanTable(unresolved, flags);
    }
    if (noChange.length > 0) {
      console.log(`\n=== Already up to date: ${noChange.length} bot(s) ===`);
    }
  }

  console.log(
    `\nSummary: ${willUpdate.length} to update · ${noChange.length} already correct · ` +
      `${skippedProtected.length} protected · ${unresolved.length} unresolved · ` +
      `${plans.length} total`,
  );

  if (!flags.apply) {
    console.log('\n[dry-run] Add --apply to commit these changes.');
    if (sshPool) await sshPool.destroy();
    await closeDb();
    return;
  }

  if (willUpdate.length === 0) {
    console.log('Nothing to apply.');
    if (sshPool) await sshPool.destroy();
    await closeDb();
    return;
  }

  // Run updates in a single transaction so a mid-batch crash doesn't
  // leave half the names overwritten.
  await db.transaction(async (trx) => {
    for (const p of willUpdate) {
      await trx('agents').where('id', p.agentPk).update({
        name: p.extractedName,
        updated_at: new Date(),
      });
    }
  });

  console.log(`\n✅ Applied ${willUpdate.length} name update(s).`);

  if (sshPool) await sshPool.destroy();
  await closeDb();
}

main().catch(async (err) => {
  console.error('Fatal:', err);
  try {
    await closeDb();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
