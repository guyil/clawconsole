import Fastify from 'fastify';
import cors from '@fastify/cors';
import { config } from './config/index.js';
import { createChildLogger } from './shared/logger.js';
import { getDb, closeDb } from './shared/db.js';
import { getRedis, closeRedis } from './shared/redis.js';
import { AppError } from './shared/errors.js';

import { SSHPool } from './transport/ssh-pool.js';
import { SSHExecutor } from './transport/ssh-executor.js';
import { FileTransfer } from './transport/file-transfer.js';
import { TailscaleClient } from './transport/tailscale.js';

import { MachineRepository } from './modules/machines/machine.repository.js';
import { MachineService } from './modules/machines/machine.service.js';
import { registerMachineRoutes } from './modules/machines/machine.routes.js';

import { AgentRepository } from './modules/agents/agent.repository.js';

import { FileRepository } from './modules/files/file.repository.js';

import { ManifestCollector } from './modules/sync/manifest-collector.js';
import { DiffEngine } from './modules/sync/diff-engine.js';
import { SyncEngine } from './modules/sync/sync-engine.js';
import { SyncRepository } from './modules/sync/sync.repository.js';
import { registerSyncRoutes } from './modules/sync/sync.routes.js';

import { CredentialRepository } from './modules/credentials/credential.repository.js';
import { CredentialService } from './modules/credentials/credential.service.js';
import { registerCredentialRoutes } from './modules/credentials/credential.routes.js';

import { SkillRepository } from './modules/skills/skill.repository.js';
import { SkillService } from './modules/skills/skill.service.js';
import { registerSkillRoutes } from './modules/skills/skill.routes.js';

import { PlaygroundRepository } from './modules/playground/playground.repository.js';
import { PlaygroundService } from './modules/playground/playground.service.js';
import { registerPlaygroundRoutes } from './modules/playground/playground.routes.js';

import { WorkflowRepository } from './modules/workflows/workflow.repository.js';
import { WorkflowService } from './modules/workflows/workflow.service.js';
import { registerWorkflowRoutes } from './modules/workflows/workflow.routes.js';

import { BotConfigAgentService } from './modules/bot-config-agent/bot-config-agent.service.js';
import { registerBotConfigAgentRoutes } from './modules/bot-config-agent/bot-config-agent.routes.js';

import { AssistantRepository } from './modules/assistant/assistant.repository.js';
import { AssistantService } from './modules/assistant/assistant.service.js';
import { registerAssistantRoutes } from './modules/assistant/assistant.routes.js';

import { MonitoringRepository } from './modules/monitoring/monitoring.repository.js';
import { MonitoringService } from './modules/monitoring/monitoring.service.js';
import { SessionMonitorService } from './modules/monitoring/session-monitor.service.js';
import { LogCollectorService } from './modules/monitoring/log-collector.service.js';
import { GatewayConnectorPool } from './modules/monitoring/gateway-connector.js';
import { registerMonitoringRoutes } from './modules/monitoring/monitoring.routes.js';

import { registerWebSocket } from './websocket/ws-server.js';
import {
  emitSessionUpdated,
  emitDiagnosticEventToClient,
} from './websocket/sync-events.js';

import { setupRecurringJobs, createWorker } from './jobs/queue.js';
import { createHealthCheckHandler } from './jobs/health-check.job.js';
import { createAutoPullHandler } from './jobs/auto-pull.job.js';
import { createSyncRetryHandler } from './jobs/sync-retry.job.js';
import { createSessionSyncHandler } from './jobs/session-sync.job.js';
import { createLogCollectorHandler } from './jobs/log-collector.job.js';

const log = createChildLogger('server');

async function main() {
  const fastify = Fastify({
    logger: false,
  });

  await fastify.register(cors, { origin: true });

  // --- WebSocket ---
  await registerWebSocket(fastify);

  // --- Infrastructure ---
  const sshPool = new SSHPool();
  const sshExecutor = new SSHExecutor(sshPool);
  const fileTransfer = new FileTransfer(sshPool);
  const tailscale = new TailscaleClient();

  // --- Repositories ---
  const machineRepo = new MachineRepository();
  const agentRepo = new AgentRepository();
  const fileRepo = new FileRepository();
  const syncRepo = new SyncRepository();
  const credentialRepo = new CredentialRepository();
  const skillRepo = new SkillRepository();

  // --- Sync Engine ---
  const manifestCollector = new ManifestCollector(sshPool);
  const diffEngine = new DiffEngine();
  const syncEngine = new SyncEngine({
    manifestCollector,
    diffEngine,
    fileTransfer,
    sshExecutor,
    fileRepository: fileRepo,
    syncRepository: syncRepo,
  });

  // --- Services ---
  const machineService = new MachineService(machineRepo, sshPool, sshExecutor, tailscale, agentRepo, skillRepo);
  const credentialService = new CredentialService(credentialRepo, fileTransfer, machineService);
  const skillService = new SkillService(skillRepo, fileTransfer, machineService, agentRepo);

  // --- Workflows ---
  const workflowRepo = new WorkflowRepository();
  const workflowService = new WorkflowService(workflowRepo, skillRepo);

  // --- Monitoring ---
  const gatewayPool = new GatewayConnectorPool();
  const monitoringRepo = new MonitoringRepository();
  const sessionMonitor = new SessionMonitorService(monitoringRepo, gatewayPool, sshPool);
  const logCollector = new LogCollectorService(monitoringRepo, sshPool);
  const monitoringService = new MonitoringService(
    monitoringRepo,
    sessionMonitor,
    logCollector,
    gatewayPool,
    machineService,
  );

  // Forward gateway events to WebSocket clients and persist diagnostic events
  gatewayPool.setEventHandler((event) => {
    const machineIds = gatewayPool.getConnectedMachineIds();
    const machineId = machineIds[0] ?? 'unknown';

    if (event.event === 'presence' || event.event === 'health') {
      const payload = event.payload as Record<string, unknown>;
      emitSessionUpdated({
        machineId,
        agentId: (payload?.agentId as string) ?? '',
        sessionKey: (payload?.sessionKey as string) ?? '',
      });
    }

    logCollector.storeDiagnosticEvent(machineId, event).catch(() => {});

    emitDiagnosticEventToClient({
      machineId,
      eventType: event.event,
      sessionKey: (event.payload as Record<string, unknown>)?.sessionKey as string,
      outcome: (event.payload as Record<string, unknown>)?.outcome as string,
    });
  });

  // --- Playground ---
  const playgroundRepo = new PlaygroundRepository();
  const playgroundService = new PlaygroundService(playgroundRepo);

  // --- Bot Config Agent ---
  const botConfigAgentService = new BotConfigAgentService({
    agentRepo,
    fileRepo,
    machineService,
    syncEngine,
    sshPool,
    fileTransfer,
  });

  // --- AI Assistant ---
  const assistantRepo = new AssistantRepository();
  const assistantService = new AssistantService(assistantRepo, {
    machineService,
    machineRepo,
    agentRepo,
    syncRepo,
    sshPool,
  });

  // --- Routes ---
  registerMachineRoutes(fastify, machineService, gatewayPool);
  registerSyncRoutes(fastify, syncEngine, syncRepo, machineService);
  registerCredentialRoutes(fastify, credentialService);
  registerSkillRoutes(fastify, skillService);
  registerMonitoringRoutes(fastify, monitoringService);
  registerPlaygroundRoutes(fastify, playgroundService);
  registerBotConfigAgentRoutes(fastify, botConfigAgentService);
  registerAssistantRoutes(fastify, assistantService);
  registerWorkflowRoutes(fastify, workflowService);

  // --- Agent Routes ---
  fastify.get('/api/agents', async () => {
    const agents = await agentRepo.findAll();
    return { data: agents, total: agents.length };
  });

  fastify.get('/api/machines/:machineId/agents', async (request) => {
    const { machineId } = request.params as { machineId: string };
    const agents = await agentRepo.findByMachineId(machineId);
    return { data: agents, total: agents.length };
  });

  fastify.get('/api/agents/:agentId', async (request) => {
    const { agentId } = request.params as { agentId: string };
    const agent = await agentRepo.findById(agentId);
    if (!agent) throw new AppError('Agent not found', 'NOT_FOUND', 404);
    // Attach machine-level global skills so frontend can display both levels
    const machine = await machineRepo.findById(agent.machineId);
    return {
      ...agent,
      globalSkills: machine?.discoveredSkills ?? [],
    };
  });

  fastify.get('/api/agents/:agentId/config-files', async (request) => {
    const { agentId } = request.params as { agentId: string };
    const query = request.query as Record<string, string>;
    const agent = await agentRepo.findById(agentId);
    if (!agent) throw new AppError('Agent not found', 'NOT_FOUND', 404);

    const machine = await machineRepo.findById(agent.machineId);
    if (!machine) throw new AppError('Machine not found', 'NOT_FOUND', 404);

    const workspace = agent.workspacePath ?? 'workspace';

    // Read from local DB cache (populated by pull sync / discovery)
    const cachedFiles = await fileRepo.findConfigFilesByWorkspace(machine.id, workspace);

    // If DB has data and no explicit refresh requested, return cached data
    if (cachedFiles.length > 0 && query.refresh !== 'true') {
      const oldestUpdate = cachedFiles.reduce(
        (min, f) => (f.updatedAt < min ? f.updatedAt : min),
        cachedFiles[0].updatedAt,
      );
      return {
        data: cachedFiles.map(({ filename, content }) => ({ filename, content })),
        lastSyncedAt: oldestUpdate.toISOString(),
      };
    }

    // Fallback to SSH: first sync or explicit refresh
    try {
      const connInfo = machineService.toConnectionInfo(machine);
      const { stdout } = await sshPool.executeCommand(
        connInfo,
        `cd ${machine.openclawHome}/${workspace} && pwd && ls -1 *.md 2>/dev/null`,
        { timeoutMs: 10_000 },
      );
      const lines = stdout.split('\n').filter(Boolean);
      if (lines.length === 0) return { data: [], lastSyncedAt: null };

      const absBasePath = lines[0];
      const filenames = lines.slice(1);

      const results: Array<{ filename: string; content: string }> = [];
      for (const filename of filenames) {
        try {
          const content = await fileTransfer.downloadFile(connInfo, `${absBasePath}/${filename}`);
          results.push({ filename, content });
        } catch {
          log.warn({ agentId, filename }, 'Failed to download config file');
        }
      }

      return { data: results, lastSyncedAt: new Date().toISOString() };
    } catch (err) {
      // If SSH fails but we have cached data, return stale cache
      if (cachedFiles.length > 0) {
        log.warn({ agentId, err }, 'SSH refresh failed, returning cached config files');
        return {
          data: cachedFiles.map(({ filename, content }) => ({ filename, content })),
          lastSyncedAt: cachedFiles[0].updatedAt.toISOString(),
          stale: true,
        };
      }
      throw err;
    }
  });

  // --- File Routes (basic) ---
  fastify.get('/api/machines/:machineId/files', async (request) => {
    const { machineId } = request.params as { machineId: string };
    const query = request.query as Record<string, string>;
    const files = await fileRepo.listFiles(machineId, {
      category: query.category as any,
      type: query.type as any,
      agentId: query.agentId,
      dirty: query.dirty === 'true' ? true : query.dirty === 'false' ? false : undefined,
    });
    return { data: files.map(({ content, ...rest }) => rest), total: files.length };
  });

  fastify.get('/api/files/:fileId', async (request) => {
    const { fileId } = request.params as { fileId: string };
    const file = await fileRepo.findById(fileId);
    if (!file) throw new AppError('File not found', 'NOT_FOUND', 404);
    return file;
  });

  fastify.put('/api/files/:fileId', async (request) => {
    const { fileId } = request.params as { fileId: string };
    const { content } = request.body as { content: string };
    if (typeof content !== 'string') {
      throw new AppError('content is required', 'VALIDATION_ERROR', 400);
    }
    await fileRepo.updateContent(fileId, content);
    return fileRepo.findById(fileId);
  });

  // --- BullMQ Workers ---
  // SSH-heavy jobs use concurrency 1 to avoid saturating the per-machine connection pool
  createWorker('health-check', createHealthCheckHandler(machineService, gatewayPool), { concurrency: 1 });
  createWorker('auto-pull', createAutoPullHandler(machineService, syncEngine), { concurrency: 1 });
  createWorker('sync-retry', createSyncRetryHandler(machineService, syncEngine, syncRepo), { concurrency: 1 });
  createWorker('session-sync', createSessionSyncHandler(monitoringService), { concurrency: 1 });
  createWorker('log-collector', createLogCollectorHandler(monitoringService), { concurrency: 1 });

  // --- Health endpoint ---
  fastify.get('/api/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  // --- Error handler ---
  fastify.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        error: error.message,
        code: error.code,
        details: error.details,
      });
    }

    log.error({ err: error, url: request.url }, 'Unhandled error');
    return reply.status(500).send({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
    });
  });

  // --- Graceful shutdown ---
  const shutdown = async () => {
    log.info('Shutting down...');
    gatewayPool.destroy();
    await fastify.close();
    await sshPool.destroy();
    await closeRedis();
    await closeDb();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // --- Start ---
  try {
    const db = getDb();
    await db.raw('SELECT 1');
    log.info('MySQL connected');

    const redis = getRedis();
    await redis.ping();
    log.info('Redis connected');

    await fastify.listen({ port: config.server.port, host: config.server.host });
    log.info(`Server running at http://${config.server.host}:${config.server.port}`);

    // Start recurring background jobs
    await setupRecurringJobs();
    log.info('Background jobs started');

    // Auto-connect gateway WebSocket for all online machines
    const onlineMachines = await machineService.listMachines({ status: 'online' });
    for (const machine of onlineMachines) {
      gatewayPool.addMachine({
        machineId: machine.id,
        host: machine.tailscaleHostname,
        port: config.gateway.defaultPort,
      });
    }
    if (onlineMachines.length > 0) {
      log.info({ count: onlineMachines.length }, 'Gateway connections initiated for online machines');
    }
  } catch (err) {
    log.error({ err }, 'Failed to start server');
    process.exit(1);
  }
}

main();
