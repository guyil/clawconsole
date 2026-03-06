import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('machines', (table) => {
    table.string('id', 36).primary();
    table.string('name', 255).notNullable();
    table.string('tailscale_hostname', 255).notNullable().unique();
    table.string('tailscale_ip', 45).nullable();
    table.string('ssh_user', 100).notNullable().defaultTo('claw');
    table.integer('ssh_port').notNullable().defaultTo(22);
    table.string('os_info', 255).nullable();
    table.string('openclaw_version', 50).nullable();
    table.string('openclaw_home', 500).notNullable().defaultTo('~/.openclaw');
    table.enum('status', ['online', 'offline', 'unknown']).notNullable().defaultTo('unknown');
    table.datetime('last_health_check_at').nullable();
    table.json('tags').nullable();
    table.datetime('created_at').notNullable().defaultTo(knex.fn.now());
    table.datetime('updated_at').notNullable().defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('machines');
}
