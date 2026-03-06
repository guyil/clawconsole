import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('session_snapshots', (table) => {
    table.increments('id').primary();
    table.string('machine_id', 36).notNullable().references('id').inTable('machines').onDelete('CASCADE');
    table.string('agent_id', 100).notNullable();
    table.string('session_key', 500).notNullable();
    table.string('session_id', 100).nullable();
    table.string('channel', 50).nullable();
    table.string('chat_type', 20).nullable();
    table.string('origin_from', 200).nullable();
    table.string('origin_to', 200).nullable();
    table.string('origin_provider', 50).nullable();
    table.string('origin_surface', 50).nullable();
    table.string('model_provider', 100).nullable();
    table.string('model', 200).nullable();
    table.string('thinking_level', 20).nullable();
    table.integer('input_tokens').defaultTo(0);
    table.integer('output_tokens').defaultTo(0);
    table.integer('total_tokens').defaultTo(0);
    table.integer('cache_read').defaultTo(0);
    table.integer('cache_write').defaultTo(0);
    table.string('label', 200).nullable();
    table.string('display_name', 200).nullable();
    table.string('send_policy', 10).nullable();
    table.integer('compaction_count').defaultTo(0);
    table.timestamp('last_activity_at').nullable();
    table.timestamp('snapshot_at').defaultTo(knex.fn.now());

    table.unique(['machine_id', 'agent_id', 'session_key'], { indexName: 'uk_session_snapshot' });
    table.index(['machine_id', 'agent_id'], 'idx_ss_machine_agent');
    table.index(['last_activity_at'], 'idx_ss_activity');
  });

  await knex.schema.createTable('session_messages', (table) => {
    table.bigIncrements('id').primary();
    table.string('machine_id', 36).notNullable().references('id').inTable('machines').onDelete('CASCADE');
    table.string('agent_id', 100).notNullable();
    table.string('session_id', 100).notNullable();
    table.integer('message_index').notNullable();
    table.enum('role', ['user', 'assistant', 'system', 'tool', 'other']).notNullable();
    table.text('content', 'longtext').nullable();
    table.string('provider', 100).nullable();
    table.string('model', 200).nullable();
    table.string('api', 50).nullable();
    table.string('stop_reason', 50).nullable();
    table.integer('input_tokens').nullable();
    table.integer('output_tokens').nullable();
    table.integer('cache_read_tokens').nullable();
    table.integer('cache_write_tokens').nullable();
    table.integer('total_tokens').nullable();
    table.decimal('cost_usd', 10, 6).nullable();
    table.bigInteger('message_timestamp').nullable();
    table.timestamp('collected_at').defaultTo(knex.fn.now());

    table.unique(['machine_id', 'session_id', 'message_index'], { indexName: 'uk_session_msg' });
    table.index(['machine_id', 'agent_id', 'session_id'], 'idx_sm_session');
    table.index(['role'], 'idx_sm_role');
    table.index(['message_timestamp'], 'idx_sm_timestamp');
  });

  await knex.schema.createTable('gateway_logs', (table) => {
    table.bigIncrements('id').primary();
    table.string('machine_id', 36).notNullable().references('id').inTable('machines').onDelete('CASCADE');
    table.enum('log_source', ['gateway', 'command', 'config_audit', 'cron_run']).notNullable();
    table.string('level', 10).nullable();
    table.string('subsystem', 100).nullable();
    table.text('message').nullable();
    table.string('session_key', 500).nullable();
    table.string('session_id', 100).nullable();
    table.string('agent_id', 100).nullable();
    table.string('channel', 50).nullable();
    table.json('extra_data').nullable();
    table.timestamp('logged_at').notNullable();
    table.timestamp('collected_at').defaultTo(knex.fn.now());

    table.index(['machine_id', 'log_source'], 'idx_gl_machine_source');
    table.index(['logged_at'], 'idx_gl_logged_at');
    table.index(['session_key'], 'idx_gl_session');
    table.index(['level'], 'idx_gl_level');
  });

  await knex.schema.createTable('diagnostic_events', (table) => {
    table.bigIncrements('id').primary();
    table.string('machine_id', 36).notNullable().references('id').inTable('machines').onDelete('CASCADE');
    table.string('event_type', 50).notNullable();
    table.string('session_key', 500).nullable();
    table.string('session_id', 100).nullable();
    table.string('channel', 50).nullable();
    table.string('provider', 100).nullable();
    table.string('model', 200).nullable();
    table.integer('duration_ms').nullable();
    table.string('outcome', 20).nullable();
    table.text('error_message').nullable();
    table.json('token_usage').nullable();
    table.json('extra_data').nullable();
    table.timestamp('event_at').notNullable();
    table.timestamp('collected_at').defaultTo(knex.fn.now());

    table.index(['machine_id', 'event_type'], 'idx_de_machine_type');
    table.index(['event_at'], 'idx_de_event_at');
    table.index(['session_key'], 'idx_de_session');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('diagnostic_events');
  await knex.schema.dropTableIfExists('gateway_logs');
  await knex.schema.dropTableIfExists('session_messages');
  await knex.schema.dropTableIfExists('session_snapshots');
}
