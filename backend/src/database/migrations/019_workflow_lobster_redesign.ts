import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Drop runtime tables — execution is now handled by Lobster on the remote machine
  await knex.schema.dropTableIfExists('workflow_reviews');
  await knex.schema.dropTableIfExists('workflow_run_nodes');
  await knex.schema.dropTableIfExists('workflow_runs');

  // Add workflow_key column for filesystem naming (like skill_key)
  const hasColumn = await knex.schema.hasColumn('workflows', 'workflow_key');
  if (!hasColumn) {
    await knex.schema.alterTable('workflows', (table) => {
      table.string('workflow_key', 255).after('name');
    });

    // Backfill existing workflows with a key derived from their name
    const rows = await knex('workflows').select('id', 'name');
    for (const row of rows) {
      const key = (row.name as string)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'workflow';
      await knex('workflows').where('id', row.id).update({ workflow_key: key });
    }

    // Now make it non-nullable and unique
    await knex.schema.alterTable('workflows', (table) => {
      table.string('workflow_key', 255).notNullable().alter();
      table.unique(['workflow_key']);
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  // Remove workflow_key column
  const hasColumn = await knex.schema.hasColumn('workflows', 'workflow_key');
  if (hasColumn) {
    await knex.schema.alterTable('workflows', (table) => {
      table.dropUnique(['workflow_key']);
      table.dropColumn('workflow_key');
    });
  }

  // Recreate runtime tables (simplified — original schema from migration 018)
  await knex.schema.createTable('workflow_runs', (table) => {
    table.uuid('id').primary();
    table.uuid('workflow_id').notNullable().references('id').inTable('workflows').onDelete('CASCADE');
    table.string('run_id', 255).notNullable().unique();
    table.uuid('machine_id').notNullable();
    table.enum('status', ['pending', 'running', 'paused', 'completed', 'failed', 'aborted']).notNullable().defaultTo('pending');
    table.json('trigger_info');
    table.json('current_nodes');
    table.json('variables');
    table.timestamp('started_at');
    table.timestamp('completed_at');
    table.text('error_message');
    table.timestamp('synced_at').defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('workflow_run_nodes', (table) => {
    table.uuid('id').primary();
    table.uuid('run_id').notNullable().references('id').inTable('workflow_runs').onDelete('CASCADE');
    table.string('node_id', 255).notNullable();
    table.enum('node_type', ['skill', 'review', 'condition']).notNullable();
    table.enum('status', ['pending', 'running', 'completed', 'failed', 'skipped', 'waiting_review']).notNullable().defaultTo('pending');
    table.json('input_json');
    table.json('output_json');
    table.timestamp('started_at');
    table.timestamp('completed_at');
    table.text('error_message');
    table.unique(['run_id', 'node_id']);
  });

  await knex.schema.createTable('workflow_reviews', (table) => {
    table.uuid('id').primary();
    table.uuid('run_id').notNullable().references('id').inTable('workflow_runs').onDelete('CASCADE');
    table.string('node_id', 255).notNullable();
    table.enum('status', ['pending', 'approved', 'rejected', 'escalated', 'expired']).notNullable().defaultTo('pending');
    table.json('reviewers').notNullable();
    table.string('policy', 50).notNullable();
    table.json('payload');
    table.timestamp('timeout_at');
    table.string('decision', 50);
    table.string('decided_by', 255);
    table.text('comments');
    table.timestamp('decided_at');
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.unique(['run_id', 'node_id']);
  });
}
