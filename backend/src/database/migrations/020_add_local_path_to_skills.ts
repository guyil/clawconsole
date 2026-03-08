import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('skills_catalog', (table) => {
    table.string('local_path', 1024).nullable().comment('Absolute path to local skill folder');
  });

  // Expand the source ENUM to include 'local'
  await knex.raw(
    "ALTER TABLE `skills_catalog` MODIFY COLUMN `source` ENUM('clawhub','custom','bundled','local') NOT NULL DEFAULT 'custom'",
  );
}

export async function down(knex: Knex): Promise<void> {
  // Revert the source ENUM
  await knex.raw(
    "ALTER TABLE `skills_catalog` MODIFY COLUMN `source` ENUM('clawhub','custom','bundled') NOT NULL DEFAULT 'custom'",
  );

  await knex.schema.alterTable('skills_catalog', (table) => {
    table.dropColumn('local_path');
  });
}
