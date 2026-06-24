import { v4 as uuidv4 } from 'uuid';
import { getDb, type Knex } from '../../shared/db.js';
import type { User, UserRole, UserStatus } from './user.types.js';

export class UserRepository {
  private get db(): Knex {
    return getDb();
  }

  async countAll(): Promise<number> {
    const row = await this.db('users').count('* as cnt').first();
    return Number(row?.cnt ?? 0);
  }

  async findAll(): Promise<User[]> {
    const rows = await this.db('users').orderBy('created_at', 'asc');
    return rows.map(this.toUser);
  }

  async findById(id: string): Promise<User | null> {
    const row = await this.db('users').where('id', id).first();
    return row ? this.toUser(row) : null;
  }

  async findByUsername(username: string): Promise<User | null> {
    const row = await this.db('users').where('username', username).first();
    return row ? this.toUser(row) : null;
  }

  async findFirstAdmin(): Promise<User | null> {
    const row = await this.db('users')
      .where('role', 'admin')
      .where('status', 'active')
      .orderBy('created_at', 'asc')
      .first();
    return row ? this.toUser(row) : null;
  }

  async create(input: {
    username: string;
    passwordHash: string;
    role: UserRole;
    status?: UserStatus;
  }): Promise<User> {
    const id = uuidv4();
    await this.db('users').insert({
      id,
      username: input.username,
      password_hash: input.passwordHash,
      role: input.role,
      status: input.status ?? 'active',
      created_at: new Date(),
      updated_at: new Date(),
    });
    return (await this.findById(id))!;
  }

  async update(
    id: string,
    updates: { passwordHash?: string; role?: UserRole; status?: UserStatus },
  ): Promise<User | null> {
    const patch: Record<string, unknown> = { updated_at: new Date() };
    if (updates.passwordHash !== undefined) patch.password_hash = updates.passwordHash;
    if (updates.role !== undefined) patch.role = updates.role;
    if (updates.status !== undefined) patch.status = updates.status;
    await this.db('users').where('id', id).update(patch);
    return this.findById(id);
  }

  async recordLogin(id: string): Promise<void> {
    await this.db('users').where('id', id).update({ last_login_at: new Date() });
  }

  async delete(id: string): Promise<boolean> {
    const deleted = await this.db('users').where('id', id).delete();
    return deleted > 0;
  }

  // ─── Assignments ─────────────────────────────────────────────────

  /** Agent UUIDs assigned to a user. */
  async getAssignedAgentIds(userId: string): Promise<string[]> {
    const rows = await this.db('user_agent_assignments')
      .where('user_id', userId)
      .select('agent_id');
    return rows.map((r) => r.agent_id as string);
  }

  /**
   * Resolve a user's assigned bots to the (machineId, agentSlug) +
   * machineId + uuid sets used for monitoring/summary scoping. Single join
   * so callers get everything they need from one round-trip.
   */
  async getAssignmentScope(userId: string): Promise<{
    agentUuids: string[];
    agentKeys: Array<[string, string]>;
    machineIds: string[];
  }> {
    const rows = await this.db('user_agent_assignments as ua')
      .join('agents', 'ua.agent_id', 'agents.id')
      .where('ua.user_id', userId)
      .select('agents.id as id', 'agents.machine_id as machine_id', 'agents.agent_id as slug');

    const agentUuids: string[] = [];
    const agentKeys: Array<[string, string]> = [];
    const machineIds = new Set<string>();
    for (const r of rows) {
      agentUuids.push(r.id as string);
      agentKeys.push([r.machine_id as string, r.slug as string]);
      machineIds.add(r.machine_id as string);
    }
    return { agentUuids, agentKeys, machineIds: [...machineIds] };
  }

  async setAssignments(userId: string, agentIds: string[]): Promise<void> {
    await this.db.transaction(async (trx) => {
      await trx('user_agent_assignments').where('user_id', userId).delete();
      if (agentIds.length > 0) {
        const unique = [...new Set(agentIds)];
        await trx('user_agent_assignments').insert(
          unique.map((agentId) => ({ user_id: userId, agent_id: agentId, created_at: new Date() })),
        );
      }
    });
  }

  private toUser(row: Record<string, unknown>): User {
    return {
      id: row.id as string,
      username: row.username as string,
      passwordHash: row.password_hash as string,
      role: row.role as UserRole,
      status: row.status as UserStatus,
      lastLoginAt: row.last_login_at ? new Date(row.last_login_at as string) : null,
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    };
  }
}
