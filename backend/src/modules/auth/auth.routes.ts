/**
 * Single-shared-password auth endpoints.
 *
 *   POST /api/auth/login   body: { password }
 *     → { token, expiresAt }  on success
 *     → 401 { error }         on wrong / missing password
 *
 *   GET  /api/auth/me
 *     → { ok: true, expiresAt } when the bearer token is still valid
 *     → 401 otherwise
 *     Used by the SPA on boot to decide whether to show the login screen.
 *
 *   POST /api/auth/logout
 *     → { ok: true } — purely a UX nicety. The token is stateless so the
 *       server can't actually revoke it; the frontend just discards its
 *       copy. Provided so the UI logout button has something to POST.
 *
 * These routes are PUBLIC (whitelisted by the global auth preHandler) so
 * an unauthenticated browser can complete the login dance.
 */
import type { FastifyInstance } from 'fastify';
import { passwordMatches, signToken, verifyToken } from './auth.token.js';
import { createChildLogger } from '../../shared/logger.js';

const log = createChildLogger('auth-routes');

interface AuthConfig {
  password: string;
  secret: string;
  tokenTtlS: number;
}

interface LoginBody {
  password?: unknown;
}

export function registerAuthRoutes(fastify: FastifyInstance, authConfig: AuthConfig): void {
  fastify.post('/api/auth/login', async (request, reply) => {
    const body = (request.body ?? {}) as LoginBody;
    const provided = typeof body.password === 'string' ? body.password : '';

    if (!authConfig.password) {
      log.error('login attempted but APP_PASSWORD is not configured');
      reply.code(503);
      return { error: 'Auth not configured on server' };
    }

    if (!passwordMatches(provided, authConfig.password)) {
      // Don't differentiate between empty and wrong — a probe shouldn't
      // learn anything from this endpoint beyond "yes, auth is required".
      reply.code(401);
      return { error: '密码错误' };
    }

    const { token, expiresAt } = signToken(authConfig.secret, authConfig.tokenTtlS);
    return { token, expiresAt };
  });

  fastify.get('/api/auth/me', async (request, reply) => {
    const header = request.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const payload = verifyToken(authConfig.secret, token);
    if (!payload) {
      reply.code(401);
      return { ok: false };
    }
    return { ok: true, expiresAt: payload.exp };
  });

  fastify.post('/api/auth/logout', async () => {
    // Stateless tokens; nothing to do server-side. Frontend clears its
    // localStorage copy after receiving 200.
    return { ok: true };
  });
}
