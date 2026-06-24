import { createChildLogger } from '../../shared/logger.js';
import { AppError } from '../../shared/errors.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import type { UserRepository } from './user.repository.js';
import {
  toPublicUser,
  type CreateUserInput,
  type PublicUser,
  type UpdateUserInput,
  type User,
  type UserRole,
} from './user.types.js';

const log = createChildLogger('user-service');

// Allow plain handles *and* email addresses as usernames (``@`` / ``+`` are
// common in work emails). Kept within 64 chars to match the users.username
// column width.
const USERNAME_RE = /^[a-zA-Z0-9._@+-]{3,64}$/;
const MIN_PASSWORD_LEN = 6;

export interface AuthScope {
  agentUuids: string[];
  /** [machineId, agentSlug] tuples for monitoring/log scoping. */
  agentKeys: Array<[string, string]>;
  machineIds: string[];
}

export class UserService {
  constructor(private repo: UserRepository) {}

  /**
   * Create the bootstrap admin if (and only if) the users table is empty.
   * Idempotent — safe to call on every boot. Reads the initial password
   * from config (ADMIN_INIT_PASSWORD, falling back to APP_PASSWORD) so a
   * fresh deploy has a way in without a manual SQL insert.
   */
  async ensureInitialAdmin(input: { username: string; password: string }): Promise<void> {
    const existing = await this.repo.countAll();
    if (existing > 0) return;
    if (!input.password) {
      log.warn(
        'No users exist and neither ADMIN_INIT_PASSWORD nor APP_PASSWORD is set — ' +
          'cannot seed an initial admin. Set ADMIN_INIT_PASSWORD in .env and restart.',
      );
      return;
    }
    const username = input.username || 'admin';
    await this.repo.create({
      username,
      passwordHash: hashPassword(input.password),
      role: 'admin',
      status: 'active',
    });
    log.info({ username }, 'Seeded initial admin user');
  }

  /** Verify credentials; returns the user on success, null otherwise. */
  async authenticate(username: string, password: string): Promise<User | null> {
    const user = await this.repo.findByUsername(username);
    if (!user) return null;
    if (user.status !== 'active') return null;
    if (!verifyPassword(password, user.passwordHash)) return null;
    await this.repo.recordLogin(user.id);
    return user;
  }

  async getById(id: string): Promise<User | null> {
    return this.repo.findById(id);
  }

  async getFirstAdmin(): Promise<User | null> {
    return this.repo.findFirstAdmin();
  }

  /** List users with their assigned agent UUIDs (for the admin UI). */
  async listUsers(): Promise<Array<PublicUser & { assignedAgentIds: string[] }>> {
    const users = await this.repo.findAll();
    const out: Array<PublicUser & { assignedAgentIds: string[] }> = [];
    for (const u of users) {
      const assignedAgentIds = u.role === 'developer' ? await this.repo.getAssignedAgentIds(u.id) : [];
      out.push({ ...toPublicUser(u), assignedAgentIds });
    }
    return out;
  }

  async createUser(input: CreateUserInput): Promise<PublicUser> {
    const username = (input.username ?? '').trim();
    if (!USERNAME_RE.test(username)) {
      throw new AppError(
        '用户名需为 3-64 位字母、数字、点、下划线、连字符或邮箱（支持 @ +）',
        'VALIDATION_ERROR',
        400,
      );
    }
    if (!input.password || input.password.length < MIN_PASSWORD_LEN) {
      throw new AppError(`密码至少需要 ${MIN_PASSWORD_LEN} 位`, 'VALIDATION_ERROR', 400);
    }
    if (input.role !== 'admin' && input.role !== 'developer') {
      throw new AppError('角色必须是 admin 或 developer', 'VALIDATION_ERROR', 400);
    }
    const existing = await this.repo.findByUsername(username);
    if (existing) throw new AppError('用户名已存在', 'CONFLICT', 409);

    const user = await this.repo.create({
      username,
      passwordHash: hashPassword(input.password),
      role: input.role,
    });
    return toPublicUser(user);
  }

  async updateUser(id: string, input: UpdateUserInput): Promise<PublicUser> {
    const user = await this.repo.findById(id);
    if (!user) throw new AppError('用户不存在', 'NOT_FOUND', 404);

    const updates: { passwordHash?: string; role?: UserRole; status?: 'active' | 'disabled' } = {};
    if (input.password !== undefined) {
      if (input.password.length < MIN_PASSWORD_LEN) {
        throw new AppError(`密码至少需要 ${MIN_PASSWORD_LEN} 位`, 'VALIDATION_ERROR', 400);
      }
      updates.passwordHash = hashPassword(input.password);
    }
    if (input.role !== undefined) {
      if (input.role !== 'admin' && input.role !== 'developer') {
        throw new AppError('角色必须是 admin 或 developer', 'VALIDATION_ERROR', 400);
      }
      updates.role = input.role;
    }
    if (input.status !== undefined) {
      if (input.status !== 'active' && input.status !== 'disabled') {
        throw new AppError('状态必须是 active 或 disabled', 'VALIDATION_ERROR', 400);
      }
      updates.status = input.status;
    }

    // Guard: never strand the console without an active admin.
    if ((updates.role === 'developer' || updates.status === 'disabled') && user.role === 'admin') {
      await this.assertNotLastAdmin(user.id);
    }

    const updated = await this.repo.update(id, updates);
    return toPublicUser(updated!);
  }

  async deleteUser(id: string): Promise<void> {
    const user = await this.repo.findById(id);
    if (!user) throw new AppError('用户不存在', 'NOT_FOUND', 404);
    if (user.role === 'admin') await this.assertNotLastAdmin(user.id);
    await this.repo.delete(id);
  }

  async setAssignments(userId: string, agentIds: string[]): Promise<string[]> {
    const user = await this.repo.findById(userId);
    if (!user) throw new AppError('用户不存在', 'NOT_FOUND', 404);
    if (user.role !== 'developer') {
      throw new AppError('只能给 developer 用户分配 Bot', 'VALIDATION_ERROR', 400);
    }
    await this.repo.setAssignments(userId, agentIds);
    return this.repo.getAssignedAgentIds(userId);
  }

  async getAssignedAgentIds(userId: string): Promise<string[]> {
    return this.repo.getAssignedAgentIds(userId);
  }

  async resolveScope(userId: string): Promise<AuthScope> {
    return this.repo.getAssignmentScope(userId);
  }

  private async assertNotLastAdmin(userId: string): Promise<void> {
    const users = await this.repo.findAll();
    const otherActiveAdmins = users.filter(
      (u) => u.role === 'admin' && u.status === 'active' && u.id !== userId,
    );
    if (otherActiveAdmins.length === 0) {
      throw new AppError('不能停用或降级最后一个管理员', 'VALIDATION_ERROR', 400);
    }
  }
}
