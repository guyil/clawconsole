import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('agents', (table) => {
    table.string('id', 36).primary();
    table.string('machine_id', 36).notNullable();
    table.string('agent_id', 100).notNullable().comment('OpenClaw agent ID, e.g. pm, brand_manager');
    table.string('name', 255).nullable();
    table.text('description').nullable();
    table.boolean('is_default').notNullable().defaultTo(false);
    table.string('workspace_path', 500).nullable().comment('Resolved workspace directory path');
    table
      .enum('status', ['draft', 'packaging', 'syncing', 'online', 'degraded', 'offline', 'archived'])
      .notNullable()
      .defaultTo('draft');
    table.datetime('last_synced_at').nullable();
    table.datetime('created_at').notNullable().defaultTo(knex.fn.now());
    table.datetime('updated_at').notNullable().defaultTo(knex.fn.now());

    table.unique(['machine_id', 'agent_id']);
    table.foreign('machine_id').references('id').inTable('machines').onDelete('CASCADE');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('agents');
}
