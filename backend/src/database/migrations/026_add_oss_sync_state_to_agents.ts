/**
 * Track per-agent OSS distill state so the UI can show "last shipped to
 * OSS at <timestamp>" without having to read the OSS bucket or grep
 * pino logs.
 *
 * Background
 * ----------
 * ``DistillPushService.pushAgent`` already returns vector_sha + per-step
 * counts, and the daily backup cron (``daily-oss-backup.job.ts``) loops
 * over every online-machine agent. Until now the result was only logged
 * via pino — not durable, not query-able from the API. After this
 * migration the service writes back to the agent row at the end of each
 * push so:
 *
 *   - ``GET /api/distill/push-to-oss/status`` can return per-agent
 *     freshness in O(1) without scraping logs.
 *   - The Bot list / detail UI can render "上次蒸馏: 2 小时前 ✅" badges.
 *   - Stuck / never-distilled agents are obvious (NULL).
 *
 * Columns
 * -------
 *   ``last_oss_sync_at``      DATETIME, nullable — wall-clock end time of
 *                             the most recent push attempt that finished
 *                             (success OR failure; the status column
 *                             disambiguates).
 *   ``last_oss_sync_status``  enum, nullable — 'ok' on success, 'failed'
 *                             on any thrown error. NULL means never
 *                             pushed since the column was added.
 *   ``last_oss_sync_error``   TEXT, nullable — truncated error message
 *                             on failure, NULL on success. We capture
 *                             this so the status panel can show *why*
 *                             a bot is stuck without making the user
 *                             tail backend logs.
 *   ``last_oss_vector_sha``   CHAR(64), nullable — sha256 of the vector
 *                             sqlite uploaded by the most recent
 *                             successful push. Mirrors what mini-claw
 *                             stores so a quick "do these match?" check
 *                             is one query away.
 *   ``last_oss_duration_ms``  INT UNSIGNED, nullable — total push wall
 *                             time in ms; useful for spotting agents
 *                             whose pushes have started getting slow
 *                             (e.g. memory grew 10x).
 *
 * NOTE: the existing ``last_synced_at`` column on ``agents`` tracks SSH
 * file pulls (memory/config refresh), NOT OSS distillation. Don't reuse
 * it — these are independent timelines.
 */
import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('agents', (table) => {
    table
      .datetime('last_oss_sync_at')
      .nullable()
      .comment('End time of the most recent OSS distill push (success or failure).');
    table
      .enum('last_oss_sync_status', ['ok', 'failed'])
      .nullable()
      .comment('Outcome of the most recent OSS distill push attempt.');
    table
      .text('last_oss_sync_error')
      .nullable()
      .comment('Truncated error message from the most recent failed push.');
    table
      .string('last_oss_vector_sha', 64)
      .nullable()
      .comment('sha256 of the vector sqlite uploaded by the most recent successful push.');
    table
      .integer('last_oss_duration_ms')
      .unsigned()
      .nullable()
      .comment('Wall-clock duration of the most recent push attempt in ms.');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('agents', (table) => {
    table.dropColumn('last_oss_sync_at');
    table.dropColumn('last_oss_sync_status');
    table.dropColumn('last_oss_sync_error');
    table.dropColumn('last_oss_vector_sha');
    table.dropColumn('last_oss_duration_ms');
  });
}
