/**
 * Add `gateway_token` to `machines`.
 *
 * directConnect (public-IP, Docker) machines are managed over the openclaw
 * gateway's HTTP surfaces (`/health`, and the `admin-http-rpc` plugin at
 * `POST /api/v1/admin/rpc`). A remote shared-token WebSocket client cannot
 * self-declare operator scopes during the connect handshake, so agent
 * discovery for these machines goes through admin-http-rpc, which authenticates
 * with the gateway shared-secret operator token as an HTTP `Authorization:
 * Bearer`. This column stores that per-machine token.
 *
 * Nullable: Tailscale fleet machines do not use it (they keep the existing
 * WebSocket RPC path), so existing rows stay NULL and are unaffected.
 */
import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('machines', (table) => {
    table
      .text('gateway_token')
      .nullable()
      .comment(
        'Shared-secret gateway operator token (openclaw gateway.auth.token) ' +
          'used as the HTTP Bearer for admin-http-rpc on directConnect machines.',
      );
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('machines', (table) => {
    table.dropColumn('gateway_token');
  });
}
