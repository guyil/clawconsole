/**
 * Console Chat feature.
 *
 * Adds:
 *   - `machines.gateway_aes_key` — the per-machine ERP `X_AUTH_TOKEN_AES_KEY`.
 *     clawconsole uses it to mint a short-lived X-AUTH-TOKEN (fixed operator
 *     identity) when proxying a chat turn to the machine's gateway
 *     `/v1/chat/completions`. Nullable + encrypted at the app layer; only
 *     directConnect machines that opt into Chat set it.
 *   - `chat_conversations` — one row per conversation thread (machine + agent).
 *   - `chat_messages`      — user/assistant messages within a conversation.
 *
 * The conversation id doubles as the openclaw `x-openclaw-session-key`, so the
 * gateway keeps per-conversation agent session continuity.
 */
import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const hasAesKey = await knex.schema.hasColumn('machines', 'gateway_aes_key');
  if (!hasAesKey) {
    await knex.schema.alterTable('machines', (table) => {
      table
        .text('gateway_aes_key')
        .nullable()
        .comment(
          'Per-machine ERP X_AUTH_TOKEN_AES_KEY used to mint the X-AUTH-TOKEN ' +
            'for console chat. Only set on Chat-enabled directConnect machines.',
        );
    });
  }

  await knex.schema.createTable('chat_conversations', (table) => {
    table.string('id', 36).primary();
    table.string('machine_id', 36).notNullable();
    table.string('agent_id', 255).notNullable().comment('openclaw agent id, e.g. bot-07');
    table.string('title', 255).nullable();
    table.string('created_by', 255).nullable().comment('clawconsole username that started it');
    table.datetime('created_at', { precision: 3 }).notNullable().defaultTo(knex.fn.now(3));
    table.datetime('updated_at', { precision: 3 }).notNullable().defaultTo(knex.fn.now(3));
    table.index(['created_by', 'updated_at'], 'idx_chat_conv_user_updated');
    table.index(['machine_id'], 'idx_chat_conv_machine');
  });

  await knex.schema.createTable('chat_messages', (table) => {
    table.string('id', 36).primary();
    table.string('conversation_id', 36).notNullable();
    table.string('role', 16).notNullable().comment('user | assistant');
    table.text('content', 'mediumtext').notNullable();
    table.datetime('created_at', { precision: 3 }).notNullable().defaultTo(knex.fn.now(3));
    table.index(['conversation_id', 'created_at'], 'idx_chat_msg_conv_created');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('chat_messages');
  await knex.schema.dropTableIfExists('chat_conversations');
  const hasAesKey = await knex.schema.hasColumn('machines', 'gateway_aes_key');
  if (hasAesKey) {
    await knex.schema.alterTable('machines', (table) => {
      table.dropColumn('gateway_aes_key');
    });
  }
}
