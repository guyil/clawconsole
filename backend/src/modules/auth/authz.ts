/**
 * Identity + authorization layer that sits on top of the bearer-token auth
 * gate. One preHandler does two jobs:
 *
 *   1. Resolve the authenticated user from the token's ``sub`` (loaded fresh
 *      from the DB every request so disabling/deleting a user takes effect
 *      immediately). Legacy/shared-password tokens (no ``sub``) resolve to a
 *      synthetic admin so the old single-password flow keeps working.
 *
 *   2. Authorize. Admins are unrestricted. Developers are DEFAULT-DENY:
 *      mostly GET on the bot/monitoring/summary surfaces (assigned bots only),
 *      read-only browse of the global Skills catalog, plus a small allowlist
 *      of scoped writes — on-demand monitoring syncs, editing an assigned
 *      bot's identity/config files, and pushing those edits to the bot's node.
 *      The resolved ``authScope`` is stashed on the request so list handlers
 *      can filter their responses, and write handlers can re-check the target
 *      against the developer's assigned bots.
 *
 * This is the single security boundary — the frontend menu/route gating is
 * pure UX and is NOT relied upon for access control.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { verifyToken } from './auth.token.js';
import { createChildLogger } from '../../shared/logger.js';
import type { UserService, AuthScope } from '../users/user.service.js';
import type { UserRole } from '../users/user.types.js';

const log = createChildLogger('authz');

export interface AuthUser {
  id: string;
  username: string;
  role: UserRole;
}

declare module 'fastify' {
  interface FastifyRequest {
    authUser?: AuthUser;
    /** Present only for developers; admins are unrestricted (undefined). */
    authScope?: AuthScope;
  }
}

interface AuthConfig {
  password: string;
  secret: string;
}

export const PUBLIC_PATHS = new Set<string>([
  '/api/health',
  '/api/auth/login',
  '/api/auth/me',
  '/api/auth/logout',
]);

const LEGACY_ADMIN: AuthUser = { id: '__legacy_admin__', username: 'admin', role: 'admin' };

export function isAgentInScope(scope: AuthScope, agentUuid: string): boolean {
  return scope.agentUuids.includes(agentUuid);
}

export function isMachineInScope(scope: AuthScope, machineId: string): boolean {
  return scope.machineIds.includes(machineId);
}

export function isAgentKeyInScope(scope: AuthScope, machineId: string, slug: string): boolean {
  return scope.agentKeys.some(([m, s]) => m === machineId && s === slug);
}

/**
 * On-demand monitoring data-collection endpoints. These are POSTs, but they
 * only pull data FROM the nodes INTO our DB for viewing — they do NOT mutate
 * the bot itself. Developers are allowed to trigger them so the monitoring
 * pages can refresh (the app has no background sync job; refresh is on-demand).
 * The route handlers re-check the target machine/agent against the developer's
 * scope, so a developer can only sync nodes/bots assigned to them.
 */
const MONITORING_SYNC_PATHS = new Set<string>([
  '/api/monitoring/sync/sessions',
  '/api/monitoring/sync/transcript',
  '/api/monitoring/sync/logs',
]);

/**
 * Pure authorization decision for a developer. Returns whether the
 * (method, path) is allowed given the developer's assignment scope.
 * Exported for unit testing.
 */
export function authorizeDeveloper(
  method: string,
  pathOnly: string,
  scope: AuthScope,
): { ok: boolean } {
  const segments = pathOnly.split('/').filter(Boolean); // ['api','agents',...]

  // ── Read-only surfaces (GET/HEAD) ──────────────────────────────────
  if (method === 'GET' || method === 'HEAD') {
    // /api/agents (list — handler filters to assigned bots)
    if (pathOnly === '/api/agents') return { ok: true };

    // /api/agents/:agentId/** — only assigned bots
    if (segments[0] === 'api' && segments[1] === 'agents' && segments[2]) {
      return { ok: isAgentInScope(scope, segments[2]) };
    }

    // Node list — handler scopes it to the developer's assigned machines and
    // redacts SSH secrets. Needed so the monitoring pages can resolve which
    // nodes to sync/filter.
    if (pathOnly === '/api/machines') return { ok: true };

    // /api/monitoring/** and /api/summaries/** — handlers scope the response.
    if (pathOnly.startsWith('/api/monitoring/')) return { ok: true };
    if (pathOnly === '/api/summaries' || pathOnly.startsWith('/api/summaries/')) return { ok: true };

    // Skills catalog (read-only). Skills are GLOBAL — not bound to a bot — so
    // there is no per-bot scoping here; developers may browse skill content
    // (list, detail, tags) but every skill mutation stays denied below.
    if (pathOnly === '/api/skills' || pathOnly.startsWith('/api/skills/')) return { ok: true };

    // Chat surface (read). The chat handlers scope nodes/bots to the
    // developer's assigned machines+bots, conversations to the requesting
    // user, and conversation-id routes re-check the target bot is in scope.
    if (pathOnly.startsWith('/api/chat/')) return { ok: true };

    return { ok: false };
  }

  // ── Editing an assigned bot's identity/config files (PUT) ──────────
  // /api/agents/:agentId/config-files/:filename — the handler validates the
  // filename (config files only, never memory) and writes to the bot's
  // workspace mirror; we just enforce the bot is assigned to this developer.
  if (method === 'PUT') {
    if (segments[0] === 'api' && segments[1] === 'agents' && segments[2] && segments[3] === 'config-files') {
      return { ok: isAgentInScope(scope, segments[2]) };
    }
    return { ok: false };
  }

  // ── Editing an assigned bot's data-permission identity (PATCH) ──────
  // /api/agents/:agentId — developers may update ONLY the data-permission
  // identity fields (dataUserId/dataUserName) on assigned bots. The bot must
  // be in scope here; the route handler enforces the field-level restriction
  // so status/name/model/oss stay admin-only.
  if (method === 'PATCH') {
    if (segments[0] === 'api' && segments[1] === 'agents' && segments[2] && !segments[3]) {
      return { ok: isAgentInScope(scope, segments[2]) };
    }
    return { ok: false };
  }

  // ── Scoped POSTs ───────────────────────────────────────────────────
  if (method === 'POST') {
    // On-demand monitoring data collection (handlers re-check scope).
    if (MONITORING_SYNC_PATHS.has(pathOnly)) return { ok: true };

    // Push edited config files to the bot's node. The machine must be in
    // scope; the route handler further restricts the pushed files to the
    // developer's assigned bots' workspaces on that node.
    if (
      segments[0] === 'api' &&
      segments[1] === 'machines' &&
      segments[2] &&
      segments[3] === 'sync' &&
      segments[4] === 'push'
    ) {
      return { ok: isMachineInScope(scope, segments[2]) };
    }

    // Chat: create a conversation / send a turn. The create handler re-checks
    // the target bot is assigned to this developer; the send handler re-checks
    // the conversation's bot is in scope.
    if (segments[0] === 'api' && segments[1] === 'chat' && segments[2] === 'conversations') {
      return { ok: true };
    }

    return { ok: false };
  }

  // ── Deleting an owned chat conversation (DELETE) ───────────────────
  if (method === 'DELETE') {
    // /api/chat/conversations/:id — handler re-checks the conversation's bot
    // is in the developer's scope before deleting.
    if (
      segments[0] === 'api' &&
      segments[1] === 'chat' &&
      segments[2] === 'conversations' &&
      segments[3]
    ) {
      return { ok: true };
    }
    return { ok: false };
  }

  return { ok: false };
}

export function registerAuthHooks(
  fastify: FastifyInstance,
  authConfig: AuthConfig,
  userService: UserService,
): void {
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
    const pathOnly = url.split('?')[0] ?? '';

    if (!pathOnly.startsWith('/api/')) return;
    if (PUBLIC_PATHS.has(pathOnly)) return;

    const header = request.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const payload = verifyToken(authConfig.secret, token);
    if (!payload) {
      reply.code(401).send({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
      return reply;
    }

    // --- Identity ---
    let authUser: AuthUser;
    if (payload.sub) {
      const user = await userService.getById(payload.sub);
      if (!user || user.status !== 'active') {
        reply.code(401).send({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
        return reply;
      }
      authUser = { id: user.id, username: user.username, role: user.role };
    } else {
      authUser = LEGACY_ADMIN;
    }
    request.authUser = authUser;

    // --- Authorization ---
    if (authUser.role === 'admin') return; // unrestricted

    const scope = await userService.resolveScope(authUser.id);
    request.authScope = scope;

    const decision = authorizeDeveloper(request.method, pathOnly, scope);
    if (!decision.ok) {
      reply.code(403).send({ error: 'Forbidden', code: 'FORBIDDEN' });
      return reply;
    }
  });
}
