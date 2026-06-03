import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { BackupService } from './backup.service.js';
import type { BackupProgressEvent } from './backup.types.js';
import { createChildLogger } from '../../shared/logger.js';

const log = createChildLogger('backup-routes');

const BackupOptionsSchema = z
  .object({
    skipRefresh: z.boolean().optional(),
    maxSessions: z.number().int().min(1).max(5_000).optional(),
  })
  .optional();

/**
 * POST /api/machines/:machineId/backup
 *
 * Streams progress as Server-Sent Events. Each event is one
 * `BackupProgressEvent` JSON-encoded payload. The connection ends
 * when the backup finishes (or fails). Body is optional and matches
 * `BackupOptions`.
 *
 * Test from a terminal:
 *
 *   curl -N -X POST http://localhost:8018/api/machines/<MACHINE_UUID>/backup \
 *     -H 'Content-Type: application/json' -d '{}'
 *
 * The first event reveals the absolute output directory; the final
 * `done` event includes per-category counts.
 *
 * Also exposed: GET /api/machines/:machineId/backup/preview returns
 * the resolved machine + a dry-run estimate (no SSH, no disk writes)
 * so the UI / caller can confirm the target before triggering.
 */
export function registerBackupRoutes(fastify: FastifyInstance, backupService: BackupService) {
  fastify.post('/api/machines/:machineId/backup', async (request, reply) => {
    const { machineId } = request.params as { machineId: string };
    const options = BackupOptionsSchema.parse(request.body ?? {}) ?? {};

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    let clientGone = false;
    request.raw.on('close', () => {
      clientGone = true;
    });

    const emit = (event: BackupProgressEvent) => {
      if (clientGone) return;
      try {
        reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
      } catch (err) {
        log.warn({ err: (err as Error).message }, 'Failed to write SSE event');
      }
    };

    try {
      await backupService.backupMachine(machineId, emit, options);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error({ machineId, err }, 'Backup failed');
      emit({ step: 'error', status: 'error', message: msg });
    } finally {
      try {
        reply.raw.end();
      } catch {
        /* connection already closed */
      }
    }

    return reply;
  });
}
