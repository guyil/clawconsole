import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('playground_sessions', (table) => {
    table.json('skill_files').nullable().after('identity_snapshot').comment('Virtual skill directory: path -> content');
    table.json('optimizer_messages').nullable().after('tool_calls_log').comment('Optimizer AI chat messages');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('playground_sessions', (table) => {
    table.dropColumn('skill_files');
    table.dropColumn('optimizer_messages');
  });
}
