import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('skills_catalog', (table) => {
    table.string('id', 36).primary();
    table.string('skill_key', 255).notNullable().unique().comment('Unique skill identifier');
    table.string('name', 255).notNullable();
    table.text('description').nullable();
    table.enum('scope', ['global', 'agent']).notNullable().defaultTo('global');
    table.enum('source', ['clawhub', 'custom', 'bundled']).notNullable().defaultTo('custom');
    table.string('version', 50).nullable();
    table.json('frontmatter').nullable().comment('Parsed YAML frontmatter as JSON');
    table.text('skill_md_content', 'longtext').nullable().comment('Full SKILL.md content');
    table.json('auxiliary_files').nullable().comment('List of other files in skill dir');
    table.json('requires_bins').nullable();
    table.json('requires_env').nullable();
    table
      .enum('review_status', ['pending', 'approved', 'rejected', 'deprecated'])
      .notNullable()
      .defaultTo('pending');
    table.string('reviewed_by', 100).nullable();
    table.datetime('reviewed_at').nullable();
    table.datetime('created_at').notNullable().defaultTo(knex.fn.now());
    table.datetime('updated_at').notNullable().defaultTo(knex.fn.now());

    table.index(['source'], 'idx_skill_source');
    table.index(['review_status'], 'idx_skill_status');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('skills_catalog');
}
