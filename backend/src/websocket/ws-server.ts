import type { FastifyInstance, FastifyRequest } from 'fastify';
import websocket from '@fastify/websocket';
import { addClient, startEventSubscriber } from './sync-events.js';
import { createChildLogger } from '../shared/logger.js';
import { verifyToken } from '../modules/auth/auth.token.js';

const log = createChildLogger('ws-server');

interface AuthConfig {
  password: string;
  secret: string;
}

export async function registerWebSocket(
  fastify: FastifyInstance,
  authConfig: AuthConfig,
): Promise<void> {
  await fastify.register(websocket);

  // Whether to enforce auth on the upgrade. Matches the HTTP gate logic:
  // a half-configured server (no password / no secret) lets connections
  // through with a warning instead of bricking the UI.
  const authEnabled = Boolean(authConfig.password && authConfig.secret);
  if (!authEnabled) {
    log.warn('WebSocket auth gate DISABLED (APP_PASSWORD/APP_AUTH_SECRET unset)');
  }

  fastify.get('/ws', { websocket: true }, (socket, request: FastifyRequest) => {
    if (authEnabled) {
      // ``@fastify/websocket`` bypasses the global preHandler hook for
      // the upgrade request, so we re-check here. Browsers can't set
      // headers on a WebSocket constructor, so the token has to ride in
      // the query string: ``ws://host/ws?token=<jwt>``.
      const tokenFromQuery =
        typeof (request.query as Record<string, unknown>)?.token === 'string'
          ? ((request.query as Record<string, string>).token as string)
          : '';
      // Also accept Authorization header for non-browser clients (curl etc.).
      const header = request.headers.authorization ?? '';
      const tokenFromHeader = header.startsWith('Bearer ') ? header.slice(7) : '';
      const token = tokenFromQuery || tokenFromHeader;

      const payload = verifyToken(authConfig.secret, token);
      if (!payload) {
        try {
          socket.send(
            JSON.stringify({
              type: 'auth_error',
              timestamp: new Date().toISOString(),
              payload: { message: 'Unauthorized' },
            }),
          );
        } catch {
          /* socket may already be closed */
        }
        socket.close(4401, 'Unauthorized');
        return;
      }
    }

    addClient(socket);

    socket.send(JSON.stringify({
      type: 'connected',
      timestamp: new Date().toISOString(),
      payload: { message: 'ClawConsole WebSocket connected' },
    }));
  });

  await startEventSubscriber();
  log.info('WebSocket server registered at /ws');
}
