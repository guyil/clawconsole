import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('skill_versions', (table) => {
    table.string('id', 36).primary();
    table.string('skill_catalog_id', 36).notNullable();
    table.string('version', 50).notNullable();
    table.text('skill_md_content', 'longtext').notNullable();
    table.json('frontmatter').nullable();
    table.json('auxiliary_files').nullable().comment('Record<filename, content>');
    table.text('change_note').nullable();
    table.datetime('created_at').notNullable().defaultTo(knex.fn.now());

    table.foreign('skill_catalog_id').references('id').inTable('skills_catalog').onDelete('CASCADE');
    table.unique(['skill_catalog_id', 'version']);
    table.index(['skill_catalog_id'], 'idx_skill_version_catalog');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('skill_versions');
}
