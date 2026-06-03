import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('agents', (table) => {
    table.json('model_config').nullable().comment('Per-agent LLM model override JSON');
  });

  await knex.schema.alterTable('machines', (table) => {
    table.json('model_config').nullable().comment('Global default LLM model config JSON');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('agents', (table) => {
    table.dropColumn('model_config');
  });

  await knex.schema.alterTable('machines', (table) => {
    table.dropColumn('model_config');
  });
}
