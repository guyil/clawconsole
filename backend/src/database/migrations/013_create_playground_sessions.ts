import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('playground_sessions', (table) => {
    table.string('id', 36).primary();
    table.string('skill_catalog_id', 36).nullable();
    table.text('skill_snapshot', 'longtext').notNullable().comment('SKILL.md content at test time');
    table.json('config').notNullable().comment('Model, tools, parameters');
    table
      .enum('status', ['active', 'completed', 'error', 'timeout'])
      .notNullable()
      .defaultTo('active');
    table.json('messages').notNullable().comment('Conversation history');
    table.json('tool_calls_log').notNullable().comment('All tool invocations');
    table.json('security_scan_result').nullable();
    table.json('error_info').nullable();
    table.datetime('started_at').notNullable().defaultTo(knex.fn.now());
    table.datetime('completed_at').nullable();
    table.datetime('created_at').notNullable().defaultTo(knex.fn.now());

    table.foreign('skill_catalog_id').references('id').inTable('skills_catalog').onDelete('SET NULL');
    table.index(['status'], 'idx_pg_session_status');
    table.index(['skill_catalog_id'], 'idx_pg_session_skill');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('playground_sessions');
}
