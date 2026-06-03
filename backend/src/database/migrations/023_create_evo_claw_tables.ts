import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('evo_runs', (table) => {
    table.increments('id').primary();
    table.string('machine_id', 36).notNullable().references('id').inTable('machines').onDelete('CASCADE');
    table.string('agent_id', 100).notNullable();
    table.enum('trigger_type', ['scheduled', 'manual', 'skill']).notNullable();
    table.enum('status', [
      'pending', 'collecting', 'classifying', 'distilling', 'applying', 'completed', 'failed',
    ]).notNullable().defaultTo('pending');
    table.integer('sessions_analyzed').defaultTo(0);
    table.integer('signals_found').defaultTo(0);
    table.integer('rules_generated').defaultTo(0);
    table.integer('cases_generated').defaultTo(0);
    table.text('summary').nullable();
    table.text('error_message').nullable();
    table.timestamp('started_at').nullable();
    table.timestamp('completed_at').nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());

    table.index(['machine_id', 'agent_id'], 'idx_er_machine_agent');
    table.index(['status'], 'idx_er_status');
    table.index(['created_at'], 'idx_er_created');
  });

  await knex.schema.createTable('evo_signals', (table) => {
    table.bigIncrements('id').primary();
    table.string('machine_id', 36).notNullable();
    table.string('agent_id', 100).notNullable();
    table.integer('evo_run_id').unsigned().notNullable()
      .references('id').inTable('evo_runs').onDelete('CASCADE');
    table.enum('signal_type', ['evaluative', 'instructive']).notNullable();
    table.enum('polarity', ['positive', 'negative', 'neutral']).nullable();
    table.string('source_session_id', 100).notNullable();
    table.integer('message_index_start').notNullable();
    table.integer('message_index_end').notNullable();
    table.text('raw_content', 'longtext').notNullable();
    table.text('hint').nullable();
    table.text('classification_reason').nullable();
    table.boolean('processed').defaultTo(false);
    table.timestamp('created_at').defaultTo(knex.fn.now());

    table.index(['evo_run_id'], 'idx_es_run');
    table.index(['machine_id', 'agent_id'], 'idx_es_machine_agent');
    table.index(['signal_type', 'polarity'], 'idx_es_type_polarity');
  });

  await knex.schema.createTable('evo_rules', (table) => {
    table.increments('id').primary();
    table.string('machine_id', 36).notNullable();
    table.string('agent_id', 100).notNullable();
    table.integer('evo_run_id').unsigned().notNullable()
      .references('id').inTable('evo_runs').onDelete('CASCADE');
    table.string('rule_key', 200).notNullable();
    table.enum('rule_type', ['constraint', 'preference', 'procedure']).notNullable();
    table.text('content').notNullable();
    table.string('target_file', 50).notNullable();
    table.string('target_section', 200).nullable();
    table.json('source_signal_ids').nullable();
    table.enum('status', ['active', 'deprecated', 'merged', 'superseded']).notNullable().defaultTo('active');
    table.float('confidence_score').defaultTo(0);
    table.integer('trigger_count').defaultTo(0);
    table.integer('positive_feedback_count').defaultTo(0);
    table.integer('negative_feedback_count').defaultTo(0);
    table.integer('merged_into_id').unsigned().nullable()
      .references('id').inTable('evo_rules').onDelete('SET NULL');
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
    table.timestamp('deprecated_at').nullable();

    table.unique(['machine_id', 'agent_id', 'rule_key'], { indexName: 'uk_evo_rule' });
    table.index(['machine_id', 'agent_id', 'status'], 'idx_erl_agent_status');
    table.index(['target_file', 'status'], 'idx_erl_file_status');
    table.index(['evo_run_id'], 'idx_erl_run');
  });

  await knex.schema.createTable('evo_cases', (table) => {
    table.increments('id').primary();
    table.string('machine_id', 36).notNullable();
    table.string('agent_id', 100).notNullable();
    table.integer('evo_run_id').unsigned().notNullable()
      .references('id').inTable('evo_runs').onDelete('CASCADE');
    table.string('case_key', 200).notNullable();
    table.text('scenario').notNullable();
    table.text('user_question_summary').notNullable();
    table.text('bot_wrong_answer_summary').notNullable();
    table.text('user_correction').notNullable();
    table.text('correct_approach').notNullable();
    table.json('source_signal_ids').nullable();
    table.enum('status', ['active', 'deprecated', 'merged']).notNullable().defaultTo('active');
    table.integer('relevance_count').defaultTo(0);
    table.integer('merged_into_id').unsigned().nullable()
      .references('id').inTable('evo_cases').onDelete('SET NULL');
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());

    table.unique(['machine_id', 'agent_id', 'case_key'], { indexName: 'uk_evo_case' });
    table.index(['machine_id', 'agent_id', 'status'], 'idx_ec_agent_status');
    table.index(['evo_run_id'], 'idx_ec_run');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('evo_cases');
  await knex.schema.dropTableIfExists('evo_rules');
  await knex.schema.dropTableIfExists('evo_signals');
  await knex.schema.dropTableIfExists('evo_runs');
}
