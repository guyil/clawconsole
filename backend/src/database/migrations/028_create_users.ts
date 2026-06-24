import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('users', (table) => {
    table.string('id', 36).primary();
    table.string('username', 64).notNullable();
    table.string('password_hash', 255).notNullable();
    table.enum('role', ['admin', 'developer']).notNullable().defaultTo('developer');
    table.enum('status', ['active', 'disabled']).notNullable().defaultTo('active');
    table.datetime('last_login_at').nullable();
    table.datetime('created_at').notNullable().defaultTo(knex.fn.now());
    table.datetime('updated_at').notNullable().defaultTo(knex.fn.now());

    table.unique(['username']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('users');
}
