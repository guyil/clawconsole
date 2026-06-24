import type { Knex } from 'knex';

/**
 * Which bots (agents) a developer user is allowed to see/manage. Admins
 * are unrestricted and never have rows here. One row per (user, agent);
 * deleting a user or agent cascades so we never leak orphaned grants.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('user_agent_assignments', (table) => {
    table.increments('id').primary();
    table.string('user_id', 36).notNullable();
    table.string('agent_id', 36).notNullable().comment('agents.id (UUID PK), not the OpenClaw slug');
    table.datetime('created_at').notNullable().defaultTo(knex.fn.now());

    table.unique(['user_id', 'agent_id']);
    table.foreign('user_id').references('id').inTable('users').onDelete('CASCADE');
    table.foreign('agent_id').references('id').inTable('agents').onDelete('CASCADE');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('user_agent_assignments');
}
