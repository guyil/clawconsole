import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('agent_skills', (table) => {
    table.string('id', 36).primary();
    table.string('agent_id', 36).notNullable();
    table.string('skill_catalog_id', 36).notNullable();
    table
      .enum('scope', ['global', 'agent'])
      .notNullable()
      .defaultTo('agent')
      .comment('global = ~/.openclaw/skills/, agent = workspace/skills/');
    table.boolean('enabled').notNullable().defaultTo(true);
    table.json('config_overrides').nullable().comment('Per-agent skill config overrides');
    table.datetime('installed_at').notNullable().defaultTo(knex.fn.now());

    table.unique(['agent_id', 'skill_catalog_id']);
    table.foreign('agent_id').references('id').inTable('agents').onDelete('CASCADE');
    table.foreign('skill_catalog_id').references('id').inTable('skills_catalog').onDelete('CASCADE');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('agent_skills');
}
