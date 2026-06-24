/**
 * Auth endpoints. Supports two login modes for a smooth migration:
 *
 *   1. Username + password (user accounts in the ``users`` table). Issues a
 *      token carrying the user's id (``sub``) so the authz layer can resolve
 *      role + assigned bots on every request.
 *
 *   2. Legacy shared password (APP_PASSWORD), kept for backward compat. On
 *      success the token is bound to the first active admin user when one
 *      exists, otherwise a sub-less "legacy admin" token is minted.
 *
 *   POST /api/auth/login   body: { username?, password }
 *     → { token, expiresAt, user } on success
 *     → 401 on bad credentials
 *
 *   GET  /api/auth/me   → { ok, expiresAt, user } | 401
 *   POST /api/auth/logout → { ok: true }
 *
 * These routes are PUBLIC (whitelisted by the global auth preHandler).
 */
import type { FastifyInstance } from 'fastify';
import { passwordMatches, signToken, verifyToken } from './auth.token.js';
import { createChildLogger } from '../../shared/logger.js';
import type { UserService } from '../users/user.service.js';
import { toPublicUser, type PublicUser } from '../users/user.types.js';

const log = createChildLogger('auth-routes');

interface AuthConfig {
  password: string;
  secret: string;
  tokenTtlS: number;
}

interface LoginBody {
  username?: unknown;
  password?: unknown;
}

const LEGACY_ADMIN_USER: PublicUser = {
  id: '__legacy_admin__',
  username: 'admin',
  role: 'admin',
  status: 'active',
  lastLoginAt: null,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};

export function registerAuthRoutes(
  fastify: FastifyInstance,
  authConfig: AuthConfig,
  userService: UserService,
): void {
  const authEnabled = Boolean(authConfig.password && authConfig.secret);

  fastify.post('/api/auth/login', async (request, reply) => {
    const body = (request.body ?? {}) as LoginBody;
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const provided = typeof body.password === 'string' ? body.password : '';

    if (!authConfig.secret) {
      log.error('login attempted but APP_AUTH_SECRET is not configured');
      reply.code(503);
      return { error: 'Auth not configured on server' };
    }

    // Mode 1: username + password against user accounts.
    if (username) {
      const user = await userService.authenticate(username, provided);
      if (!user) {
        reply.code(401);
        return { error: '用户名或密码错误' };
      }
      const { token, expiresAt } = signToken(authConfig.secret, authConfig.tokenTtlS, user.id);
      return { token, expiresAt, user: toPublicUser(user) };
    }

    // Mode 2: legacy shared password.
    if (!authConfig.password) {
      reply.code(401);
      return { error: '请输入用户名和密码' };
    }
    if (!passwordMatches(provided, authConfig.password)) {
      reply.code(401);
      return { error: '密码错误' };
    }
    const admin = await userService.getFirstAdmin();
    const { token, expiresAt } = signToken(
      authConfig.secret,
      authConfig.tokenTtlS,
      admin?.id,
    );
    return { token, expiresAt, user: admin ? toPublicUser(admin) : LEGACY_ADMIN_USER };
  });

  fastify.get('/api/auth/me', async (request, reply) => {
    // Auth disabled (dev/staging): report a synthetic admin so the SPA loads.
    if (!authEnabled) {
      return { ok: true, expiresAt: null, user: LEGACY_ADMIN_USER };
    }

    const header = request.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const payload = verifyToken(authConfig.secret, token);
    if (!payload) {
      reply.code(401);
      return { ok: false };
    }

    if (payload.sub) {
      const user = await userService.getById(payload.sub);
      if (!user || user.status !== 'active') {
        reply.code(401);
        return { ok: false };
      }
      return { ok: true, expiresAt: payload.exp, user: toPublicUser(user) };
    }

    // Legacy sub-less token → admin.
    return { ok: true, expiresAt: payload.exp, user: LEGACY_ADMIN_USER };
  });

  fastify.post('/api/auth/logout', async () => {
    return { ok: true };
  });
}
