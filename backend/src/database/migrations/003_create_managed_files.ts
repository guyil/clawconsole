import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('managed_files', (table) => {
    table.string('id', 36).primary();
    table.string('machine_id', 36).notNullable();
    table.string('agent_id', 36).nullable().comment('NULL for machine-level files');
    table.string('relative_path', 1000).notNullable().comment('Path relative to ~/.openclaw/');
    table
      .enum('file_category', ['console_managed', 'runtime_observable', 'system_internal'])
      .notNullable()
      .defaultTo('console_managed');
    table
      .enum('file_type', ['config', 'persona', 'skill', 'credential', 'cron', 'hook', 'log', 'session', 'memory', 'other'])
      .notNullable()
      .defaultTo('other');
    table.text('content', 'longtext').nullable().comment('File content as text blob');
    table.string('content_hash', 64).nullable().comment('SHA-256 of content in DB');
    table.string('remote_hash', 64).nullable().comment('Last known SHA-256 on remote');
    table.bigInteger('remote_mtime').nullable().comment('Last known mtime on remote (unix epoch)');
    table.bigInteger('remote_size').nullable().comment('Last known file size in bytes');
    table.boolean('local_dirty').notNullable().defaultTo(false).comment('Edited in Console, not yet synced');
    table.boolean('remote_dirty').notNullable().defaultTo(false).comment('Remote changed since last pull');
    table.datetime('created_at').notNullable().defaultTo(knex.fn.now());
    table.datetime('updated_at').notNullable().defaultTo(knex.fn.now());

    table.index(['machine_id', 'local_dirty'], 'idx_machine_dirty');
    table.index(['machine_id', 'remote_dirty'], 'idx_machine_remote_dirty');
    table.index(['agent_id'], 'idx_agent_files');
    table.index(['file_category'], 'idx_file_category');
    table.foreign('machine_id').references('id').inTable('machines').onDelete('CASCADE');
    table.foreign('agent_id').references('id').inTable('agents').onDelete('SET NULL');
  });

  // Prefix unique index for relative_path (VARCHAR 1000 is too long for full unique)
  await knex.raw(
    'CREATE UNIQUE INDEX uk_machine_path ON managed_files (machine_id, relative_path(255))',
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('managed_files');
}
