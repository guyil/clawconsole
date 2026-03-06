import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('machines', (table) => {
    table.json('discovered_skills').nullable().after('tags');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('machines', (table) => {
    table.dropColumn('discovered_skills');
  });
}
