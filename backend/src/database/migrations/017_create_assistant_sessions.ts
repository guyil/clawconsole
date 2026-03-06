import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('assistant_sessions', (table) => {
    table.string('id', 36).primary();
    table.string('title', 255).nullable();
    table.json('messages').notNullable().comment('Conversation history');
    table.json('tool_calls_log').notNullable().comment('All tool invocations');
    table.datetime('created_at').notNullable().defaultTo(knex.fn.now());
    table.datetime('updated_at').notNullable().defaultTo(knex.fn.now());

    table.index(['created_at'], 'idx_assistant_session_created');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('assistant_sessions');
}
