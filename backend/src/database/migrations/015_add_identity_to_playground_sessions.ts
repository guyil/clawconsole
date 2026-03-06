import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('playground_sessions', (table) => {
    table.string('agent_id', 36).nullable().after('skill_catalog_id');
    table.json('identity_snapshot').nullable().after('skill_snapshot').comment('Bot identity files at test time');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('playground_sessions', (table) => {
    table.dropColumn('agent_id');
    table.dropColumn('identity_snapshot');
  });
}
