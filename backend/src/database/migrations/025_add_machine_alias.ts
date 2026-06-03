/**
 * Add `alias` column to `machines` for human-readable, globally-unique
 * machine identifiers used as the prefix in distilled agent_keys.
 *
 * Background
 * ----------
 * The platform side previously derived a machine's slug from the first
 * segment of `machine.id` (a UUID). Two machines whose UUIDs happen to
 * share the same first segment would distill into the same hub
 * agent_key namespace. Unlikely in practice but a real correctness hazard.
 *
 * Going forward, every machine must have a human-readable `alias` (e.g.
 * `claw-prod-1`) that the operator picks at machine-create time. The
 * platform's `_slugify_agent_key` consumes `alias` first and only falls
 * back to the UUID first-segment when alias is empty.
 *
 * Backfill
 * --------
 * We backfill alias = slugified machine.name for every existing row so
 * the system stays functional immediately after deployment. Operators can
 * change the alias via the machines UI afterwards.
 */
import type { Knex } from 'knex';

function slugify(value: string): string {
  return (value || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/(^-+|-+$)/g, '')
    .slice(0, 64);
}

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('machines', (table) => {
    table
      .string('alias', 64)
      .nullable()
      .comment(
        'Human-readable machine alias used as agent_key prefix in distilled ' +
          'Mini Claw bots. Must be globally unique among connected machines.',
      );
  });

  const rows = await knex('machines').select('id', 'name');
  for (const row of rows) {
    const alias = slugify(row.name) || `claw-${(row.id || '').split('-')[0]}`;
    await knex('machines').where('id', row.id).update({ alias });
  }

  // Enforce uniqueness AFTER the backfill so the migration doesn't fail
  // on a half-migrated state. Operators are expected to resolve any
  // duplicate-name machines manually before applying.
  await knex.schema.alterTable('machines', (table) => {
    table.unique(['alias'], { indexName: 'uq_machines_alias' });
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('machines', (table) => {
    table.dropUnique(['alias'], 'uq_machines_alias');
    table.dropColumn('alias');
  });
}
