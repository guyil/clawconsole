import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('credentials_store', (table) => {
    table.string('id', 36).primary();
    table.string('machine_id', 36).nullable().comment('NULL for global credentials');
    table.string('name', 255).notNullable();
    table
      .enum('credential_type', ['api_key', 'oauth_token', 'allow_from', 'pairing', 'webhook_secret', 'other'])
      .notNullable();
    table.string('provider', 100).nullable().comment('e.g. anthropic, feishu, openrouter');
    table.text('encrypted_value', 'mediumtext').notNullable().comment('AES-256-GCM encrypted JSON');
    table.string('encryption_iv', 32).notNullable().comment('Initialization vector (hex)');
    table.string('encryption_tag', 32).notNullable().comment('Auth tag (hex)');
    table.string('target_file_path', 500).nullable().comment('Target path under credentials/');
    table.text('description').nullable();
    table.datetime('created_at').notNullable().defaultTo(knex.fn.now());
    table.datetime('updated_at').notNullable().defaultTo(knex.fn.now());

    table.index(['machine_id'], 'idx_cred_machine');
    table.index(['provider'], 'idx_cred_provider');
    table.foreign('machine_id').references('id').inTable('machines').onDelete('CASCADE');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('credentials_store');
}
