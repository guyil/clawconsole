import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('sync_operations', (table) => {
    table.string('id', 36).primary();
    table.string('machine_id', 36).notNullable();
    table.enum('sync_type', ['hot', 'warm', 'cold', 'pull', 'full_pull']).notNullable();
    table.enum('sync_direction', ['push', 'pull', 'bidirectional']).notNullable();
    table
      .enum('status', ['pending', 'in_progress', 'completed', 'partial_failure', 'failed'])
      .notNullable()
      .defaultTo('pending');
    table.string('triggered_by', 100).nullable().comment('Username or system');
    table.integer('total_files').notNullable().defaultTo(0);
    table.integer('synced_files').notNullable().defaultTo(0);
    table.integer('failed_files').notNullable().defaultTo(0);
    table.text('error_message').nullable();
    table.datetime('started_at').nullable();
    table.datetime('completed_at').nullable();
    table.integer('duration_ms').nullable();
    table.boolean('requires_restart').notNullable().defaultTo(false);
    table.boolean('restart_performed').notNullable().defaultTo(false);
    table.integer('retry_count').notNullable().defaultTo(0);
    table.string('parent_operation_id', 36).nullable().comment('If this is a retry of a previous op');
    table.datetime('created_at').notNullable().defaultTo(knex.fn.now());

    table.index(['machine_id', 'created_at'], 'idx_machine_ops');
    table.index(['status'], 'idx_status');
    table.foreign('machine_id').references('id').inTable('machines').onDelete('CASCADE');
    table.foreign('parent_operation_id').references('id').inTable('sync_operations').onDelete('SET NULL');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('sync_operations');
}
