import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('sync_operation_files', (table) => {
    table.string('id', 36).primary();
    table.string('sync_operation_id', 36).notNullable();
    table.string('managed_file_id', 36).nullable();
    table.string('relative_path', 1000).notNullable();
    table.enum('action', ['create', 'update', 'delete', 'skip', 'conflict']).notNullable();
    table
      .enum('status', ['pending', 'completed', 'failed', 'skipped'])
      .notNullable()
      .defaultTo('pending');
    table.string('before_hash', 64).nullable();
    table.string('after_hash', 64).nullable();
    table.bigInteger('file_size_bytes').nullable();
    table.text('error_message').nullable();
    table.datetime('created_at').notNullable().defaultTo(knex.fn.now());

    table.index(['sync_operation_id'], 'idx_op_files');
    table.index(['managed_file_id'], 'idx_file_history');
    table.foreign('sync_operation_id').references('id').inTable('sync_operations').onDelete('CASCADE');
    table.foreign('managed_file_id').references('id').inTable('managed_files').onDelete('SET NULL');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('sync_operation_files');
}
