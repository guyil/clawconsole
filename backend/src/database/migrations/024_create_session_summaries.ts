import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('session_summaries', (table) => {
    table.bigIncrements('id').primary();
    table.string('machine_id', 36).notNullable().references('id').inTable('machines').onDelete('CASCADE');
    table.string('agent_id', 100).notNullable();
    // Nullable FK so the row survives if the bot is later deleted in-console.
    table.string('agent_uuid', 36).nullable();

    // MySQL with explicit_defaults_for_timestamp=1 (e.g. Alibaba RDS) refuses
    // TIMESTAMP NOT NULL without an explicit DEFAULT, so we anchor both window
    // bounds to CURRENT_TIMESTAMP. Application code always supplies real values
    // on INSERT — these defaults are only there to satisfy the schema check.
    table.timestamp('period_start_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('period_end_at').notNullable().defaultTo(knex.fn.now());

    table.integer('session_count').notNullable().defaultTo(0);
    table.integer('message_count').notNullable().defaultTo(0);
    table.integer('input_tokens').notNullable().defaultTo(0);
    table.integer('output_tokens').notNullable().defaultTo(0);
    table.integer('total_tokens').notNullable().defaultTo(0);

    table.string('model', 100).nullable();
    table.text('summary_markdown', 'longtext').nullable();

    table.enum('trigger', ['scheduled', 'manual']).notNullable().defaultTo('scheduled');
    table.enum('status', ['success', 'empty', 'failed']).notNullable().defaultTo('success');
    table.text('error_message').nullable();

    table.boolean('feishu_pushed').notNullable().defaultTo(false);
    table.text('feishu_push_error').nullable();

    table.timestamp('created_at').defaultTo(knex.fn.now());

    table.index(['machine_id', 'agent_id', 'period_end_at'], 'idx_summ_bot_end');
    table.index(['period_end_at'], 'idx_summ_end');
    table.index(['trigger'], 'idx_summ_trigger');
  });

  await knex.schema.alterTable('agents', (table) => {
    table.boolean('summary_push_enabled').notNullable().defaultTo(false)
      .comment('Whether scheduled 12h summaries for this bot are pushed to Feishu');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('agents', (table) => {
    table.dropColumn('summary_push_enabled');
  });
  await knex.schema.dropTableIfExists('session_summaries');
}
