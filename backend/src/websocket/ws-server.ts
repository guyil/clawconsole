import type { FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import { addClient, startEventSubscriber } from './sync-events.js';
import { createChildLogger } from '../shared/logger.js';

const log = createChildLogger('ws-server');

export async function registerWebSocket(fastify: FastifyInstance): Promise<void> {
  await fastify.register(websocket);

  fastify.get('/ws', { websocket: true }, (socket, _request) => {
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
