import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('agents', (table) => {
    table.json('discovered_skills').nullable().after('workspace_path');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('agents', (table) => {
    table.dropColumn('discovered_skills');
  });
}
