import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Workflow definitions
  await knex.schema.createTable('workflows', (table) => {
    table.string('id', 36).primary();
    table.string('name', 255).notNullable();
    table.text('description').nullable();
    table.string('machine_id', 36).notNullable();
    table.string('agent_id', 255).nullable().comment('NULL = machine-level workflow');
    table
      .enum('status', ['draft', 'active', 'disabled', 'archived'])
      .defaultTo('draft');
    table.string('version', 50).defaultTo('1.0.0');
    table.json('trigger_config').notNullable().comment('{ type, channel, pattern, cron }');
    table.json('nodes_json').notNullable().comment('Array of node definitions');
    table.json('edges_json').notNullable().comment('Array of edge definitions');
    table.json('variables_json').nullable().comment('Workflow-level variable declarations');
    table.json('canvas_state').nullable().comment('React Flow canvas position/zoom');
    table.string('created_by', 255).notNullable();
    table.string('updated_by', 255).nullable();
    table.datetime('deployed_at').nullable();
    table.datetime('created_at').defaultTo(knex.fn.now());
    table.datetime('updated_at').defaultTo(knex.fn.now());

    table.foreign('machine_id').references('id').inTable('machines').onDelete('CASCADE');
    table.index(['status'], 'idx_workflows_status');
    table.index(['machine_id'], 'idx_workflows_machine');
    table.index(['agent_id'], 'idx_workflows_agent');
  });

  // Workflow version snapshots
  await knex.schema.createTable('workflow_versions', (table) => {
    table.string('id', 36).primary();
    table.string('workflow_id', 36).notNullable();
    table.string('version', 50).notNullable();
    table.json('snapshot_json').notNullable().comment('Full workflow definition snapshot');
    table.text('change_log').nullable();
    table.string('created_by', 255).notNullable();
    table.datetime('created_at').defaultTo(knex.fn.now());

    table.foreign('workflow_id').references('id').inTable('workflows').onDelete('CASCADE');
    table.unique(['workflow_id', 'version'], { indexName: 'idx_workflow_version_unique' });
  });

  // Workflow execution records (synced from remote)
  await knex.schema.createTable('workflow_runs', (table) => {
    table.string('id', 36).primary();
    table.string('workflow_id', 36).notNullable();
    table.string('run_id', 255).notNullable().comment('Lobster-generated run ID');
    table.string('machine_id', 36).notNullable();
    table
      .enum('status', ['pending', 'running', 'paused', 'completed', 'failed', 'aborted'])
      .defaultTo('pending');
    table.json('trigger_info').nullable();
    table.json('current_nodes').nullable().comment('Currently executing node IDs');
    table.json('variables').nullable().comment('Runtime variable values');
    table.datetime('started_at').nullable();
    table.datetime('completed_at').nullable();
    table.text('error_message').nullable();
    table.datetime('synced_at').defaultTo(knex.fn.now());

    table.foreign('workflow_id').references('id').inTable('workflows').onDelete('CASCADE');
    table.foreign('machine_id').references('id').inTable('machines').onDelete('CASCADE');
    table.unique(['run_id'], { indexName: 'idx_workflow_runs_run_id' });
    table.index(['status'], 'idx_workflow_runs_status');
    table.index(['workflow_id'], 'idx_workflow_runs_workflow');
  });

  // Workflow node execution outputs (synced from remote)
  await knex.schema.createTable('workflow_run_nodes', (table) => {
    table.string('id', 36).primary();
    table.string('run_id', 36).notNullable().comment('FK → workflow_runs.id');
    table.string('node_id', 255).notNullable();
    table.enum('node_type', ['skill', 'review', 'condition']).notNullable();
    table
      .enum('status', ['pending', 'running', 'completed', 'failed', 'skipped', 'waiting_review'])
      .defaultTo('pending');
    table.json('input_json').nullable();
    table.json('output_json').nullable();
    table.datetime('started_at').nullable();
    table.datetime('completed_at').nullable();
    table.text('error_message').nullable();

    table.foreign('run_id').references('id').inTable('workflow_runs').onDelete('CASCADE');
    table.unique(['run_id', 'node_id'], { indexName: 'idx_run_node_unique' });
  });

  // Review records
  await knex.schema.createTable('workflow_reviews', (table) => {
    table.string('id', 36).primary();
    table.string('run_id', 36).notNullable();
    table.string('node_id', 255).notNullable();
    table
      .enum('status', ['pending', 'approved', 'rejected', 'escalated', 'expired'])
      .defaultTo('pending');
    table.json('reviewers').notNullable().comment('Designated reviewer list');
    table.string('policy', 50).notNullable().comment('any | all | count(N)');
    table.json('payload').nullable().comment('Content shown to reviewer');
    table.datetime('timeout_at').nullable();
    table.enum('decision', ['approved', 'rejected']).nullable();
    table.string('decided_by', 255).nullable();
    table.text('comments').nullable();
    table.datetime('decided_at').nullable();
    table.datetime('created_at').defaultTo(knex.fn.now());

    table.foreign('run_id').references('id').inTable('workflow_runs').onDelete('CASCADE');
    table.unique(['run_id', 'node_id'], { indexName: 'idx_review_run_node_unique' });
    table.index(['status'], 'idx_workflow_reviews_status');
    table.index(['decided_by'], 'idx_workflow_reviews_decided_by');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('workflow_reviews');
  await knex.schema.dropTableIfExists('workflow_run_nodes');
  await knex.schema.dropTableIfExists('workflow_runs');
  await knex.schema.dropTableIfExists('workflow_versions');
  await knex.schema.dropTableIfExists('workflows');
}
