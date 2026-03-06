import { v4 as uuidv4 } from 'uuid';
import { getDb, type Knex } from '../../shared/db.js';
import { encrypt, decrypt, type EncryptedPayload } from '../../shared/crypto.js';
import type { Credential, CreateCredentialInput, CredentialType } from './credential.types.js';

export class CredentialRepository {
  private get db(): Knex {
    return getDb();
  }

  async findAll(filters?: { machineId?: string; provider?: string }): Promise<Credential[]> {
    let query = this.db('credentials_store').select(
      'id', 'machine_id', 'name', 'credential_type', 'provider',
      'target_file_path', 'description', 'created_at', 'updated_at',
    );

    if (filters?.machineId) query = query.where('machine_id', filters.machineId);
    if (filters?.provider) query = query.where('provider', filters.provider);

    const rows = await query.orderBy('created_at', 'desc');
    return rows.map(this.toCredential);
  }

  async findById(id: string): Promise<Credential | null> {
    const row = await this.db('credentials_store')
      .select('id', 'machine_id', 'name', 'credential_type', 'provider',
        'target_file_path', 'description', 'created_at', 'updated_at')
      .where('id', id)
      .first();
    return row ? this.toCredential(row) : null;
  }

  async create(input: CreateCredentialInput): Promise<Credential> {
    const id = uuidv4();
    const encrypted = encrypt(input.value);
    const now = new Date();

    await this.db('credentials_store').insert({
      id,
      machine_id: input.machineId ?? null,
      name: input.name,
      credential_type: input.credentialType,
      provider: input.provider ?? null,
      encrypted_value: encrypted.ciphertext,
      encryption_iv: encrypted.iv,
      encryption_tag: encrypted.tag,
      target_file_path: input.targetFilePath ?? null,
      description: input.description ?? null,
      created_at: now,
      updated_at: now,
    });

    return (await this.findById(id))!;
  }

  async updateValue(id: string, newValue: string): Promise<void> {
    const encrypted = encrypt(newValue);
    await this.db('credentials_store').where('id', id).update({
      encrypted_value: encrypted.ciphertext,
      encryption_iv: encrypted.iv,
      encryption_tag: encrypted.tag,
      updated_at: new Date(),
    });
  }

  async updateMeta(id: string, updates: { name?: string; targetFilePath?: string; description?: string }): Promise<void> {
    const data: Record<string, unknown> = { updated_at: new Date() };
    if (updates.name !== undefined) data.name = updates.name;
    if (updates.targetFilePath !== undefined) data.target_file_path = updates.targetFilePath;
    if (updates.description !== undefined) data.description = updates.description;
    await this.db('credentials_store').where('id', id).update(data);
  }

  async getDecryptedValue(id: string): Promise<string | null> {
    const row = await this.db('credentials_store')
      .select('encrypted_value', 'encryption_iv', 'encryption_tag')
      .where('id', id)
      .first();
    if (!row) return null;

    const payload: EncryptedPayload = {
      ciphertext: row.encrypted_value as string,
      iv: row.encryption_iv as string,
      tag: row.encryption_tag as string,
    };
    return decrypt(payload);
  }

  async findByMachineAndPath(machineId: string, targetPath: string): Promise<Credential | null> {
    const row = await this.db('credentials_store')
      .select('id', 'machine_id', 'name', 'credential_type', 'provider',
        'target_file_path', 'description', 'created_at', 'updated_at')
      .where({ machine_id: machineId, target_file_path: targetPath })
      .first();
    return row ? this.toCredential(row) : null;
  }

  async delete(id: string): Promise<boolean> {
    const deleted = await this.db('credentials_store').where('id', id).delete();
    return deleted > 0;
  }

  private toCredential(row: Record<string, unknown>): Credential {
    return {
      id: row.id as string,
      machineId: row.machine_id as string | null,
      name: row.name as string,
      credentialType: row.credential_type as CredentialType,
      provider: row.provider as string | null,
      targetFilePath: row.target_file_path as string | null,
      description: row.description as string | null,
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    };
  }
}
