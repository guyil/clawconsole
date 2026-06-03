/**
 * Per-agent opt-in/opt-out for the daily OSS distill backup.
 *
 * Background
 * ----------
 * Until now the ``daily-oss-backup`` cron (see ``daily-oss-backup.job.ts``)
 * pushed *every* non-draft agent on every online machine. That's the right
 * default for a small fleet, but as the fleet grows there are real reasons
 * to exclude individual bots from the nightly run:
 *
 *   - Heavy/cold bots whose ``openclaw memory index`` step blows past the
 *     per-agent timeout night after night.
 *   - Experimental / personal bots that don't belong in the shared OSS
 *     scope.
 *   - Bots whose owner explicitly opts out for privacy reasons.
 *
 * With this column the UI can render a per-bot toggle and the cron honours
 * it; manual ``push-to-oss/single`` and ``push-to-oss/machine`` continue
 * to work regardless of the flag (manual is a user-initiated override).
 *
 * Default
 * -------
 * ``TRUE`` for every existing row. Backwards compatible: the daily cron's
 * behaviour for already-deployed bots stays exactly the same on the first
 * boot after this migration.
 *
 * Why a column and not a config table
 * -----------------------------------
 * The toggle is per-agent and is read on every cron pass. Joining a side
 * table would force ``daily-oss-backup.job.ts`` to do an extra query per
 * machine for what is effectively a one-bit flag.
 */
import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('agents', (table) => {
    table
      .boolean('oss_sync_enabled')
      .notNullable()
      .defaultTo(true)
      .comment(
        'Whether the daily OSS distill backup includes this agent. ' +
          'Manual push-to-oss endpoints ignore this flag.',
      );
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('agents', (table) => {
    table.dropColumn('oss_sync_enabled');
  });
}
