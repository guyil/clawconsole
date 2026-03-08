import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('skills_catalog', (table) => {
    table.json('tags').nullable().comment('JSON array of tag strings for categorization');
  });

  // Index for JSON_CONTAINS queries on tags
  await knex.raw(
    'ALTER TABLE `skills_catalog` ADD INDEX `idx_skills_catalog_tags` ((CAST(`tags` AS CHAR(512) ARRAY)))',
  ).catch(() => {
    // Multi-valued index requires MySQL 8.0.17+; skip gracefully on older versions
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('skills_catalog', (table) => {
    table.dropColumn('tags');
  });
}
