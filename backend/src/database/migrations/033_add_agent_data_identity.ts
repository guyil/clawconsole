/**
 * Per-bot data identity (数据权限).
 *
 * Data permission on the ERP fork is enforced by the 数据中台, keyed by the
 * sender identity (user_id / user_name) carried in the X-AUTH-TOKEN. To give
 * different bots different data scopes, clawconsole (the caller) presents a
 * per-bot identity when proxying a chat turn: it mints the X-AUTH-TOKEN with
 * the bot's assigned `data_user_id` / `data_user_name` instead of the global
 * CHAT_OPERATOR identity. The 数据中台 then returns data scoped to that
 * identity.
 *
 * Both nullable: a bot with neither set falls back to the global operator
 * identity (`config.chat.operatorUserId` / `operatorUserName`).
 */
import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('agents', (table) => {
    table
      .string('data_user_id', 255)
      .nullable()
      .comment('数据中台 sender user_id used to scope this bot\'s data permission');
    table
      .string('data_user_name', 255)
      .nullable()
      .comment('数据中台 sender user_name paired with data_user_id');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('agents', (table) => {
    table.dropColumn('data_user_id');
    table.dropColumn('data_user_name');
  });
}
