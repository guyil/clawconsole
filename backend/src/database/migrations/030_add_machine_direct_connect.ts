/**
 * Add `gateway_port` and `direct_connect` columns to `machines` to support
 * public-IP, Docker-hosted openclaw machines alongside the existing
 * Tailscale fleet.
 *
 * Background
 * ----------
 * clawconsole historically only managed machines that sit on Tailscale,
 * reached by `tailscale_hostname` over SSH port 22 and a gateway WebSocket
 * on a GLOBAL port (`config.gateway.defaultPort`, 18789), with the gateway
 * lifecycle driven by `systemctl --user openclaw`.
 *
 * A public-IP, Docker-hosted node is different on two axes:
 *   - It is reached by raw IP (stored in `tailscale_hostname`) + a custom
 *     SSH port, with NO Tailscale peer — so the Tailscale ping gate must be
 *     skipped and SSH/gateway must connect directly.
 *   - Its gateway is Docker-published on a PER-MACHINE host port, and a
 *     single gateway hosts MANY agents (no per-host openclawHome to `find`).
 *
 * Columns
 * -------
 *   `gateway_port`    INTEGER, nullable — host port for this machine's
 *                     gateway WS/HTTP. NULL → fall back to the global
 *                     default (18789). Existing rows stay NULL, so their
 *                     connector behaviour is byte-for-byte unchanged.
 *   `direct_connect`  BOOLEAN, NOT NULL DEFAULT false — when true, skip the
 *                     Tailscale ping/resolve gate and probe SSH + gateway
 *                     HTTP `/health` directly. Default false so every
 *                     existing Tailscale machine behaves exactly as before.
 */
import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('machines', (table) => {
    table
      .integer('gateway_port')
      .nullable()
      .comment(
        'Host port where this machine\'s openclaw gateway is reachable. ' +
          'NULL falls back to the global GATEWAY_DEFAULT_PORT (18789).',
      );
    table
      .boolean('direct_connect')
      .notNullable()
      .defaultTo(false)
      .comment(
        'When true, this is a public-IP machine: skip the Tailscale ping ' +
          'gate and connect SSH/gateway directly to tailscale_hostname (a raw IP).',
      );
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('machines', (table) => {
    table.dropColumn('gateway_port');
    table.dropColumn('direct_connect');
  });
}
