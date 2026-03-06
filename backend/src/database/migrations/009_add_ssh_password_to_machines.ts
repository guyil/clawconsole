import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('machines', (table) => {
    table.string('ssh_password', 255).nullable().after('ssh_port');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('machines', (table) => {
    table.dropColumn('ssh_password');
  });
}
