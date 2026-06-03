/**
 * Global Fastify preHandler that gates every /api/* request behind a
 * valid bearer token signed with APP_AUTH_SECRET.
 *
 * Whitelisted (no token required):
 *   - GET  /api/health          — liveness probe used by deploy.sh / nginx
 *   - POST /api/auth/login      — the password exchange itself
 *   - GET  /api/auth/me         — token validity probe (handles its own 401)
 *   - POST /api/auth/logout     — purely informational
 *
 * Non-/api/* routes are passed through (WebSocket auth lives in
 * ws-server.ts because @fastify/websocket bypasses preHandlers for the
 * upgrade request).
 *
 * If APP_PASSWORD is unset we LOG a loud warning and let every request
 * through. That's intentional — a half-deployed staging box should be
 * usable rather than bricked, and the warning + 503 from /auth/login
 * make the misconfiguration obvious.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { verifyToken } from './auth.token.js';
import { createChildLogger } from '../../shared/logger.js';

const log = createChildLogger('auth-middleware');

interface AuthConfig {
  password: string;
  secret: string;
}

const PUBLIC_PATHS = new Set<string>([
  '/api/health',
  '/api/auth/login',
  '/api/auth/me',
  '/api/auth/logout',
]);

export function registerAuthHook(fastify: FastifyInstance, authConfig: AuthConfig): void {
  const enabled = Boolean(authConfig.password && authConfig.secret);
  if (!enabled) {
    log.warn(
      'APP_PASSWORD or APP_AUTH_SECRET is not set — HTTP auth gate DISABLED. ' +
        'Set both in .env / .env.production to require login.',
    );
    return;
  }

  fastify.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    const url = request.raw.url ?? request.url;
    // Strip query string before matching so /api/health?ts=... still passes.
    const pathOnly = url.split('?')[0] ?? '';

    if (!pathOnly.startsWith('/api/')) return; // non-API (none currently, but defensive)
    if (PUBLIC_PATHS.has(pathOnly)) return;

    const header = request.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const payload = verifyToken(authConfig.secret, token);
    if (!payload) {
      reply.code(401).send({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
      return reply;
    }
  });
}
