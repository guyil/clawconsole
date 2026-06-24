import Fastify from 'fastify';
import cors from '@fastify/cors';
import { config } from './config/index.js';
import { createChildLogger } from './shared/logger.js';
import { getDb, closeDb } from './shared/db.js';
import { getRedis, closeRedis } from './shared/redis.js';
import { closeAllBrowsers, initTracing, getAllAgentConfigs } from './shared/langgraph/index.js';
import { AppError } from './shared/errors.js';

// Initialize LangSmith tracing before any LLM calls
initTracing();

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
import { ChatRepository } from './modules/chat/chat.repository.js';
import { ChatService } from './modules/chat/chat.service.js';
import { registerChatRoutes } from './modules/chat/chat.routes.js';

import { MonitoringRepository } from './modules/monitoring/monitoring.repository.js';
import { MonitoringService } from './modules/monitoring/monitoring.service.js';
import { SessionMonitorService } from './modules/monitoring/session-monitor.service.js';
import { LogCollectorService } from './modules/monitoring/log-collector.service.js';
import { GatewayConnectorPool } from './modules/monitoring/gateway-connector.js';
import { registerMonitoringRoutes } from './modules/monitoring/monitoring.routes.js';

import { ModelConfigService } from './modules/model-config/model-config.service.js';

import { registerAuthRoutes } from './modules/auth/auth.routes.js';
import { registerAuthHooks } from './modules/auth/authz.js';
import { UserRepository } from './modules/users/user.repository.js';
import { UserService } from './modules/users/user.service.js';
import { registerUserRoutes } from './modules/users/user.routes.js';

import { registerWebSocket } from './websocket/ws-server.js';
import {
  emitSessionUpdated,
  emitDiagnosticEventToClient,
} from './websocket/sync-events.js';

import { PlatformSkillRegistry, allPlatformSkills } from './shared/platform-skills/index.js';
import { classifyMemoryFile, type MemoryFileRecord } from './shared/memory-classifier.js';
import { hashContent } from './shared/crypto.js';
import type { ManagedFile } from './modules/files/file.types.js';

import {
  setupRecurringJobs,
  createWorker,
  dailyOssBackupQueue,
  manualOssDistillQueue,
} from './jobs/queue.js';
import { createHealthCheckHandler } from './jobs/health-check.job.js';
import { createAutoPullHandler } from './jobs/auto-pull.job.js';
import { createSyncRetryHandler } from './jobs/sync-retry.job.js';
import { createSessionSyncHandler } from './jobs/session-sync.job.js';
import { createLogCollectorHandler } from './jobs/log-collector.job.js';
import { createEvoClawHandler } from './jobs/evo-claw.job.js';

import { EvoClawRepository } from './modules/evo-claw/evo-claw.repository.js';
import { EvoClawService } from './modules/evo-claw/evo-claw.service.js';
import { registerEvoClawRoutes } from './modules/evo-claw/evo-claw.routes.js';
import { createTriggerEvolutionSkill } from './shared/platform-skills/skills/trigger-evolution.skill.js';

import { BackupService } from './modules/backup/backup.service.js';
import { registerBackupRoutes } from './modules/backup/backup.routes.js';

import { SummaryRepository } from './modules/summaries/summary.repository.js';
import { SummaryService } from './modules/summaries/summary.service.js';
import { GeminiClient } from './modules/summaries/gemini-client.js';
import { FeishuNotifier } from './modules/summaries/feishu-notifier.js';
import { registerSummaryRoutes } from './modules/summaries/summary.routes.js';
import { registerDistillPushRoutes } from './modules/distill-push/distill-push.routes.js';
import { DistillPushService } from './modules/distill-push/distill-push.service.js';
import { createSummaryHandler } from './jobs/summary.job.js';
import { createDailyOssBackupHandler } from './jobs/daily-oss-backup.job.js';
import { createManualOssDistillHandler } from './jobs/manual-oss-distill.job.js';

const log = createChildLogger('server');

const BOT_CONFIG_FILENAMES = new Set([
  'SOUL.md',
  'IDENTITY.md',
  'USER.md',
  'AGENTS.md',
  'TOOLS.md',
  'BOOTSTRAP.md',
  'HEARTBEAT.md',
  'README.md',
]);

interface BotConfigFileMetadata {
  id: string;
  filename: string;
  relativePath: string;
  content: string;
  localDirty: boolean;
  remoteDirty: boolean;
  updatedAt: Date;
}

function validateBotConfigFilename(filename: string): string {
  if (
    typeof filename !== 'string' ||
    !BOT_CONFIG_FILENAMES.has(filename) ||
    filename.includes('/') ||
    filename.includes('\\') ||
    filename.includes('..')
  ) {
    throw new AppError('Unsupported bot config filename', 'VALIDATION_ERROR', 400);
  }
  return filename;
}

function isBotConfigFilename(filename: string): boolean {
  return BOT_CONFIG_FILENAMES.has(filename);
}

function formatBotConfigFile(file: BotConfigFileMetadata) {
  return {
    id: file.id,
    filename: file.filename,
    relativePath: file.relativePath,
    content: file.content,
    localDirty: file.localDirty,
    remoteDirty: file.remoteDirty,
    updatedAt: file.updatedAt.toISOString(),
  };
}

function formatManagedBotConfigFile(file: ManagedFile) {
  return formatBotConfigFile({
    id: file.id,
    filename: file.relativePath.split('/').pop() ?? file.relativePath,
    relativePath: file.relativePath,
    content: file.content ?? '',
    localDirty: file.localDirty,
    remoteDirty: file.remoteDirty,
    updatedAt: file.updatedAt,
  });
}

function groupMemoryFiles(records: MemoryFileRecord[]) {
  const core: MemoryFileRecord[] = [];
  const daily: MemoryFileRecord[] = [];
  const sessionSnapshots: MemoryFileRecord[] = [];

  for (const r of records) {
    if (r.category === 'core') core.push(r);
    else if (r.category === 'daily') daily.push(r);
    else sessionSnapshots.push(r);
  }

  return {
    data: { core, daily, sessionSnapshots },
    totalFiles: records.length,
    lastSyncedAt: records[0]?.updatedAt?.toISOString() ?? null,
  };
}

async function main() {
  const fastify = Fastify({
    logger: false,
  });

  await fastify.register(cors, { origin: true });

  // --- Users + Auth (register BEFORE other routes so the global authz
  // preHandler applies to everything that follows; auth routes and
  // /api/health are whitelisted inside authz.ts.) ---
  const userRepo = new UserRepository();
  const userService = new UserService(userRepo);
  await userService.ensureInitialAdmin({
    username: config.auth.adminInitUsername,
    password: config.auth.adminInitPassword,
  });
  registerAuthRoutes(fastify, config.auth, userService);
  registerAuthHooks(fastify, config.auth, userService);
  registerUserRoutes(fastify, userService);

  // --- WebSocket ---
  await registerWebSocket(fastify, config.auth);

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

  // --- Model Config ---
  const modelConfigService = new ModelConfigService(sshPool, fileTransfer, machineService, machineRepo, agentRepo);

  // --- Platform Skills Registry ---
  const platformSkills = new PlatformSkillRegistry({ sshPool, machineService, machineRepo, agentRepo });
  platformSkills.registerAll(allPlatformSkills);

  // --- Workflows ---
  const workflowRepo = new WorkflowRepository();
  const workflowService = new WorkflowService(workflowRepo, skillRepo, machineService, agentRepo, fileTransfer);

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

  // --- ECA (evoClawAssociation) ---
  const evoRepo = new EvoClawRepository();
  const ecaService = new EvoClawService({
    evoRepo,
    monitoringRepo,
    fileRepo,
    agentRepo,
    syncEngine,
    machineService,
    modelName: config.evoClaw.judgeModel,
    maxRulesPerFile: config.evoClaw.maxRulesPerFile,
    decayThresholdRuns: config.evoClaw.decayThresholdRuns,
    minSessions: config.evoClaw.minSessions,
  });
  platformSkills.register(createTriggerEvolutionSkill(ecaService));

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
    platformSkills,
  });

  // --- Console Chat (talk to bots via gateway /v1) ---
  const chatRepo = new ChatRepository();
  const chatService = new ChatService(chatRepo, { machineRepo, agentRepo });

  // --- Session Summaries (Gemini + Feishu) ---
  // Gemini client is constructed regardless of whether the API key is set;
  // the service and routes surface a clear 503 + warning when it's missing
  // so the rest of the app still boots cleanly.
  const summaryRepo = new SummaryRepository();
  const geminiClient = new GeminiClient(
    config.summaries.geminiApiKey,
    config.summaries.model,
  );
  const feishuNotifier = new FeishuNotifier({
    appId: config.summaries.feishu.appId,
    appSecret: config.summaries.feishu.appSecret,
    chatId: config.summaries.feishu.summaryChatId,
  });
  const summaryService = new SummaryService({
    repo: summaryRepo,
    agentRepo,
    machineRepo,
    gemini: geminiClient,
    feishu: feishuNotifier,
    windowHours: config.summaries.windowHours,
  });
  if (!geminiClient.isConfigured()) {
    log.warn('GEMINI_API_KEY not set — session summaries will be skipped');
  }
  if (!feishuNotifier.isConfigured()) {
    log.warn({ hint: feishuNotifier.missingConfigHint() }, 'Feishu summary push disabled (missing config)');
  }

  // --- Backup ---
  // Orchestrates a full per-machine backup using the existing sync/monitoring
  // services, then exports the DB cache to <BACKUP_ROOT>/<machine>/<timestamp>/.
  const backupService = new BackupService(
    machineService,
    agentRepo,
    fileRepo,
    skillRepo,
    monitoringRepo,
    syncEngine,
    sessionMonitor,
    config.backup.root,
  );

  // --- OSS distill push service ---
  // Single shared instance: both the HTTP routes
  // (POST /api/distill/push-to-oss/*) and the daily backup cron use this.
  // Sharing the instance lets the per-machine ``$HOME`` cache survive
  // across requests AND across cron ticks, which avoids one ``printf
  // $HOME`` round-trip per agent on warm machines.
  const distillPushService = new DistillPushService(
    sshPool,
    fileTransfer,
    machineRepo,
    agentRepo,
  );

  // --- Routes ---
  registerMachineRoutes(fastify, machineService, gatewayPool);
  registerSyncRoutes(fastify, syncEngine, syncRepo, machineService, agentRepo);
  registerCredentialRoutes(fastify, credentialService);
  registerSkillRoutes(fastify, skillService);
  registerMonitoringRoutes(fastify, monitoringService);
  registerPlaygroundRoutes(fastify, playgroundService);
  registerBotConfigAgentRoutes(fastify, botConfigAgentService);
  registerAssistantRoutes(fastify, assistantService);
  registerChatRoutes(fastify, chatService);
  registerWorkflowRoutes(fastify, workflowService);
  registerEvoClawRoutes(fastify, ecaService);
  registerBackupRoutes(fastify, backupService);
  registerSummaryRoutes(fastify, summaryService, agentRepo);
  await registerDistillPushRoutes(fastify, {
    distillPushService,
    machineRepo,
    agentRepo,
    // Pass the live queues so GET /api/distill/push-to-oss/status can
    // surface "next scheduled run" + "last N runs" + "currently in flight"
    // from BullMQ. POST routes also enqueue onto manualOssDistillQueue
    // instead of awaiting the 5+min push pipeline inline.
    dailyOssBackupQueue,
    manualOssDistillQueue,
  });

  // --- Agent Routes ---
  fastify.get('/api/agents', async (request) => {
    const agents = await agentRepo.findAll();
    // Developers only see bots assigned to them; admins (no authScope) see all.
    const scoped = request.authScope
      ? agents.filter((a) => request.authScope!.agentUuids.includes(a.id))
      : agents;
    return { data: scoped, total: scoped.length };
  });

  fastify.get('/api/machines/:machineId/agents', async (request) => {
    const { machineId } = request.params as { machineId: string };
    const agents = await agentRepo.findByMachineId(machineId);
    const scoped = request.authScope
      ? agents.filter((a) => request.authScope!.agentUuids.includes(a.id))
      : agents;
    return { data: scoped, total: scoped.length };
  });

  fastify.post('/api/machines/:machineId/agents', async (request, reply) => {
    const { machineId } = request.params as { machineId: string };
    const body = request.body as {
      agentId: string;
      name?: string;
      description?: string;
      isDefault?: boolean;
    };

    if (!body.agentId || typeof body.agentId !== 'string') {
      throw new AppError('agentId is required', 'VALIDATION_ERROR', 400);
    }

    if (!/^[a-z][a-z0-9_-]{1,49}$/.test(body.agentId)) {
      throw new AppError(
        'agentId must start with a lowercase letter and contain only lowercase letters, numbers, hyphens, and underscores (2-50 chars)',
        'VALIDATION_ERROR',
        400,
      );
    }

    const machine = await machineRepo.findById(machineId);
    if (!machine) throw new AppError('Machine not found', 'NOT_FOUND', 404);

    const existing = await agentRepo.findByMachineAndAgentId(machineId, body.agentId);
    if (existing) {
      // Allow retry: reuse a draft/failed agent record instead of rejecting
      if (existing.status === 'draft' || existing.status === 'packaging') {
        const updated = await agentRepo.update(existing.id, {
          name: body.name,
          description: body.description,
          status: 'draft',
        });
        return reply.status(200).send(updated);
      }
      throw new AppError(`Agent "${body.agentId}" already exists on this machine`, 'CONFLICT', 409);
    }

    const agent = await agentRepo.create({
      machineId,
      agentId: body.agentId,
      name: body.name,
      description: body.description,
      isDefault: body.isDefault,
    });

    return reply.status(201).send(agent);
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

  /**
   * PATCH /api/agents/:agentId
   *
   * Partial update for the agent row. Currently surfaces on the
   * BotDetailPage header as an inline-edit "rename Bot" affordance, but
   * the shape mirrors the full ``UpdateAgentInput`` so we can wire
   * description / status / modelConfig edits later without another
   * round-trip on this route.
   *
   * Field handling:
   *   - `name` / `description`: trimmed; an empty string is normalised
   *     to `null` so the UI falls back to displaying `agentId`. Length
   *     is capped at 200 chars to keep the column sane and the layout
   *     from overflowing.
   *   - `agentId` is deliberately NOT editable here — it's the join key
   *     against the remote openclaw workspace folder name; renaming it
   *     would orphan the entire on-disk state.
   *   - Unknown fields are silently ignored (Fastify's body is loose;
   *     we never spread it directly into the repo update).
   */
  fastify.patch('/api/agents/:agentId', async (request, reply) => {
    const { agentId } = request.params as { agentId: string };
    const body = (request.body ?? {}) as {
      name?: string | null;
      description?: string | null;
      status?: string;
      modelConfig?: unknown;
      ossSyncEnabled?: unknown;
    };

    const existing = await agentRepo.findById(agentId);
    if (!existing) throw new AppError('Agent not found', 'NOT_FOUND', 404);

    const normalizeStr = (v: string | null | undefined): string | null | undefined => {
      if (v === undefined) return undefined;
      if (v === null) return null;
      if (typeof v !== 'string') {
        throw new AppError('Field must be a string or null', 'BAD_REQUEST', 400);
      }
      const trimmed = v.trim();
      if (trimmed.length > 200) {
        throw new AppError('Field exceeds 200 character limit', 'BAD_REQUEST', 400);
      }
      return trimmed === '' ? null : trimmed;
    };

    const updates: Parameters<typeof agentRepo.update>[1] = {};
    if ('name' in body) updates.name = normalizeStr(body.name);
    if ('description' in body) updates.description = normalizeStr(body.description);
    if (body.status !== undefined) {
      const allowed = new Set([
        'draft', 'packaging', 'syncing', 'online', 'degraded', 'offline', 'archived',
      ]);
      if (!allowed.has(body.status)) {
        throw new AppError(`Invalid status: ${body.status}`, 'BAD_REQUEST', 400);
      }
      updates.status = body.status as Parameters<typeof agentRepo.update>[1]['status'];
    }
    // Per-bot opt-out for the nightly OSS distill cron. Manual push
    // endpoints stay unaffected — flipping this to ``false`` only removes
    // the bot from the scheduled run.
    if (body.ossSyncEnabled !== undefined) {
      if (typeof body.ossSyncEnabled !== 'boolean') {
        throw new AppError('ossSyncEnabled must be a boolean', 'BAD_REQUEST', 400);
      }
      updates.ossSyncEnabled = body.ossSyncEnabled;
    }
    // modelConfig has its own dedicated PUT route (with validation +
    // remote sync side-effects); we don't accept it through this generic
    // patch to keep the side-effects out of an unexpected codepath.

    if (Object.keys(updates).length === 0) {
      return reply.status(200).send(existing);
    }

    const updated = await agentRepo.update(agentId, updates);
    if (!updated) throw new AppError('Agent not found after update', 'NOT_FOUND', 404);

    log.info({ agentId, fields: Object.keys(updates) }, 'Agent updated');
    return reply.status(200).send(updated);
  });

  fastify.delete('/api/agents/:agentId', async (request, reply) => {
    const { agentId } = request.params as { agentId: string };
    const query = request.query as Record<string, string>;
    const cleanRemote = query.cleanRemote === 'true';

    const agent = await agentRepo.findById(agentId);
    if (!agent) throw new AppError('Agent not found', 'NOT_FOUND', 404);

    let remoteCleanupFailed = false;

    if (cleanRemote && agent.workspacePath) {
      const machine = await machineRepo.findById(agent.machineId);
      if (!machine) throw new AppError('Machine not found', 'NOT_FOUND', 404);

      const connInfo = machineService.toConnectionInfo(machine);
      const remotePath = `${machine.openclawHome}/${agent.workspacePath}`;
      try {
        await fileTransfer.removeDirectory(connInfo, remotePath);
        log.info({ agentId, remotePath }, 'Remote workspace removed');
      } catch (err) {
        remoteCleanupFailed = true;
        log.warn({ agentId, remotePath, err: (err as Error).message }, 'Remote cleanup failed, proceeding with DB delete');
      }
    }

    await agentRepo.delete(agentId);
    log.info({ agentId, cleanRemote, remoteCleanupFailed }, 'Agent deleted');

    return reply.status(200).send({
      deleted: true,
      ...(remoteCleanupFailed ? { remoteCleanupFailed: true } : {}),
    });
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
    const cachedConfigFiles = cachedFiles.filter((f) => isBotConfigFilename(f.filename));

    // If DB has data and no explicit refresh requested, return cached data
    if (cachedConfigFiles.length > 0 && query.refresh !== 'true') {
      const oldestUpdate = cachedConfigFiles.reduce(
        (min, f) => (f.updatedAt < min ? f.updatedAt : min),
        cachedConfigFiles[0].updatedAt,
      );
      return {
        data: cachedConfigFiles.map(formatBotConfigFile),
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
      if (lines.length === 0) {
        if (cachedConfigFiles.length > 0) {
          return {
            data: cachedConfigFiles.map(formatBotConfigFile),
            lastSyncedAt: cachedConfigFiles[0].updatedAt.toISOString(),
          };
        }
        return { data: [], lastSyncedAt: null };
      }

      const absBasePath = lines[0];
      const filenames = lines.slice(1).filter(isBotConfigFilename);
      if (filenames.length === 0) {
        if (cachedConfigFiles.length > 0) {
          return {
            data: cachedConfigFiles.map(formatBotConfigFile),
            lastSyncedAt: cachedConfigFiles[0].updatedAt.toISOString(),
          };
        }
        return { data: [], lastSyncedAt: null };
      }

      // Batch download via a single SFTP channel to avoid the per-file
      // open/close round-trip cost. Much faster than mapping
      // `downloadFile` over each filename for many small markdown files.
      const paths = filenames.map((f) => `${absBasePath}/${f}`);
      const contents = await fileTransfer.downloadFilesBulk(connInfo, paths);

      const results: BotConfigFileMetadata[] = [];
      for (let i = 0; i < filenames.length; i++) {
        const filename = filenames[i];
        const content = contents[i];
        if (content === null) {
          log.warn({ agentId, filename }, 'Failed to download config file');
          continue;
        }
        const existingFile = await fileRepo.findByPath(machine.id, `${workspace}/${filename}`);
        if (existingFile?.localDirty) {
          results.push({
            id: existingFile.id,
            filename,
            relativePath: existingFile.relativePath,
            content: existingFile.content ?? '',
            localDirty: existingFile.localDirty,
            remoteDirty: existingFile.remoteDirty,
            updatedAt: existingFile.updatedAt,
          });
          continue;
        }

        const contentHash = hashContent(content);
        await fileRepo.upsertFile({
          machineId: machine.id,
          relativePath: `${workspace}/${filename}`,
          content,
          contentHash,
          remoteHash: contentHash,
          remoteMtime: null,
          remoteSize: content.length,
          localDirty: false,
          remoteDirty: false,
        });
        const savedFile = await fileRepo.findByPath(machine.id, `${workspace}/${filename}`);
        if (savedFile) {
          results.push({
            id: savedFile.id,
            filename,
            relativePath: savedFile.relativePath,
            content: savedFile.content ?? '',
            localDirty: savedFile.localDirty,
            remoteDirty: savedFile.remoteDirty,
            updatedAt: savedFile.updatedAt,
          });
        }
      }

      // Stamp the agent's last sync time so the UI can show an accurate
      // "last synced" timestamp. Without this, agents.last_synced_at would
      // only reflect the initial deploy time even though files are being
      // refreshed via this endpoint.
      if (results.length > 0) {
        await agentRepo.updateSyncTime(agent.id);
      }

      return { data: results.map(formatBotConfigFile), lastSyncedAt: new Date().toISOString() };
    } catch (err) {
      // If SSH fails but we have cached data, return stale cache
      if (cachedConfigFiles.length > 0) {
        log.warn({ agentId, err }, 'SSH refresh failed, returning cached config files');
        return {
          data: cachedConfigFiles.map(formatBotConfigFile),
          lastSyncedAt: cachedConfigFiles[0].updatedAt.toISOString(),
          stale: true,
        };
      }
      throw err;
    }
  });

  fastify.put('/api/agents/:agentId/config-files/:filename', async (request) => {
    const { agentId, filename: rawFilename } = request.params as { agentId: string; filename: string };
    const { content } = request.body as { content?: unknown };
    if (typeof content !== 'string') {
      throw new AppError('content must be a string', 'VALIDATION_ERROR', 400);
    }

    const filename = validateBotConfigFilename(rawFilename);
    const agent = await agentRepo.findById(agentId);
    if (!agent) throw new AppError('Agent not found', 'NOT_FOUND', 404);

    const machine = await machineRepo.findById(agent.machineId);
    if (!machine) throw new AppError('Machine not found', 'NOT_FOUND', 404);

    const workspace = agent.workspacePath ?? 'workspace';
    const relativePath = `${workspace}/${filename}`;
    const existing = await fileRepo.findByPath(machine.id, relativePath);

    if (existing) {
      await fileRepo.updateContent(existing.id, content);
    } else {
      await fileRepo.upsertFile({
        machineId: machine.id,
        relativePath,
        content,
        contentHash: hashContent(content),
        remoteHash: null,
        remoteMtime: null,
        remoteSize: null,
        localDirty: true,
        remoteDirty: false,
      });
    }

    const updated = await fileRepo.findByPath(machine.id, relativePath);
    if (!updated) throw new AppError('Config file not found after update', 'NOT_FOUND', 404);

    log.info({ agentId, filename, relativePath }, 'Bot config file updated in DB mirror');
    return { data: formatManagedBotConfigFile(updated) };
  });

  // --- Re-discover skills for an agent's machine ---
  fastify.post('/api/agents/:agentId/rediscover-skills', async (request) => {
    const { agentId } = request.params as { agentId: string };
    const agent = await agentRepo.findById(agentId);
    if (!agent) throw new AppError('Agent not found', 'NOT_FOUND', 404);

    const discovery = await machineService.discoverStructure(agent.machineId);

    const freshAgent = await agentRepo.findById(agentId);
    const machine = await machineRepo.findById(agent.machineId);

    return {
      globalSkills: machine?.discoveredSkills ?? [],
      agentSkills: freshAgent?.discoveredSkills ?? [],
      discovery,
    };
  });

  // --- Remove discovered skills (agent-level and machine-level) ---

  fastify.delete('/api/agents/:agentId/discovered-skills/:skillKey', async (request, reply) => {
    const { agentId, skillKey } = request.params as { agentId: string; skillKey: string };
    const agent = await agentRepo.findById(agentId);
    if (!agent) throw new AppError('Agent not found', 'NOT_FOUND', 404);

    const currentSkills = agent.discoveredSkills ?? [];
    if (!currentSkills.includes(skillKey)) {
      throw new AppError(`Skill "${skillKey}" not found on this agent`, 'NOT_FOUND', 404);
    }

    const machine = await machineRepo.findById(agent.machineId);
    if (!machine) throw new AppError('Machine not found', 'NOT_FOUND', 404);

    const workspace = agent.workspacePath ?? 'workspace';
    const skillDir = `${machine.openclawHome}/${workspace}/skills/${skillKey}`;
    const connInfo = machineService.toConnectionInfo(machine);

    await sshPool.executeCommand(connInfo, `rm -rf ${skillDir}`, { timeoutMs: 15_000 });

    const updatedSkills = currentSkills.filter((s) => s !== skillKey);
    await agentRepo.updateDiscoveredSkills(agent.id, updatedSkills);

    log.info({ agentId, skillKey, skillDir }, 'Agent discovered skill removed');
    return reply.status(204).send();
  });

  fastify.delete('/api/agents/:agentId/global-skills/:skillKey', async (request, reply) => {
    const { agentId, skillKey } = request.params as { agentId: string; skillKey: string };
    const agent = await agentRepo.findById(agentId);
    if (!agent) throw new AppError('Agent not found', 'NOT_FOUND', 404);

    const machine = await machineRepo.findById(agent.machineId);
    if (!machine) throw new AppError('Machine not found', 'NOT_FOUND', 404);

    const globalSkills = machine.discoveredSkills ?? [];
    if (!globalSkills.includes(skillKey)) {
      throw new AppError(`Global skill "${skillKey}" not found on this machine`, 'NOT_FOUND', 404);
    }

    const skillDir = `${machine.openclawHome}/skills/${skillKey}`;
    const connInfo = machineService.toConnectionInfo(machine);

    await sshPool.executeCommand(connInfo, `rm -rf ${skillDir}`, { timeoutMs: 15_000 });

    const updatedSkills = globalSkills.filter((s) => s !== skillKey);
    await machineRepo.updateDiscoveredSkills(machine.id, updatedSkills);

    log.info({ agentId, machineId: machine.id, skillKey, skillDir }, 'Global discovered skill removed');
    return reply.status(204).send();
  });

  // --- Memory files endpoint ---
  // Uses two SSH calls: one for root memory files, one for memory/ subdirectory.
  // Each follows the exact same pattern as config-files (which is proven to work).
  fastify.get('/api/agents/:agentId/memory-files', async (request) => {
    const { agentId } = request.params as { agentId: string };
    const query = request.query as Record<string, string>;
    const agent = await agentRepo.findById(agentId);
    if (!agent) throw new AppError('Agent not found', 'NOT_FOUND', 404);

    const machine = await machineRepo.findById(agent.machineId);
    if (!machine) throw new AppError('Machine not found', 'NOT_FOUND', 404);

    const workspace = agent.workspacePath ?? 'workspace';
    const emptyResult = { data: { core: [], daily: [], sessionSnapshots: [] }, totalFiles: 0, lastSyncedAt: null };

    // Try DB cache first
    const cached = await fileRepo.findMemoryFilesByAgent(machine.id, workspace);
    if (cached.length > 0 && query.refresh !== 'true') {
      return groupMemoryFiles(cached);
    }

    // Hard cap so the request can't hang forever if SSH or the pool gets
    // wedged. With downloadFilesBulk a normal workspace finishes in ~5-15s;
    // 45s is a generous safety margin. On timeout the cached response from
    // MySQL is returned with `stale: true`.
    const REQUEST_TIMEOUT_MS = 45_000;

    const fetchViaSSH = async () => {
      const t0 = Date.now();
      const connInfo = machineService.toConnectionInfo(machine);
      const wsDir = `${machine.openclawHome}/${workspace}`;
      const results: Array<{ filename: string; relativePath: string; content: string }> = [];

      // Single SSH round-trip to enumerate everything we want to sync:
      //   1. Workspace-root MEMORY.md / memory.md (case variants)
      //   2. memory/**/*.md — RECURSIVE so nested categories like
      //      memory/competitive-intelligence/, memory/storytelling/,
      //      memory/archive/, memory/product-lifecycle/ etc. are captured.
      //
      // We use `find -type f -name '*.md'` instead of `ls -1 *.md` because
      // the former recurses into subdirectories. Output paths are returned
      // RELATIVE to the memory/ root (e.g. `./foo.md`,
      // `./competitive-intelligence/intent-framework.md`) so we can
      // reconstruct accurate workspace-relative paths downstream.
      //
      // Bulk-download happens in a second SSH round-trip below.
      const { stdout: lsStdout } = await sshPool.executeCommand(
        connInfo,
        `cd ${wsDir} && pwd && ls -1 MEMORY.md memory.md 2>/dev/null; ` +
          `echo '===CLAWMEMDIR==='; ` +
          `(cd ${wsDir}/memory 2>/dev/null && pwd && ` +
          `  find . -type f -name '*.md' -print 2>/dev/null | sed 's|^\\./||' | sort) || true`,
        { timeoutMs: 15_000 },
      );
      const tList = Date.now();
      const [rootSection, memSection = ''] = lsStdout.split('===CLAWMEMDIR===');
      const rootLines = rootSection.split('\n').filter(Boolean);
      const rootBasePath = rootLines[0] ?? '';
      const rootFiles = rootLines.slice(1);
      const memLines = memSection.split('\n').filter(Boolean);
      const memBasePath = memLines[0] ?? '';
      // memFiles entries are RELATIVE to memory/ — possibly nested,
      // e.g. "active-tasks.md" or "competitive-intelligence/intent-framework.md".
      const memFiles = memLines.slice(1);
      const allPaths = [
        ...rootFiles.map((f) => ({ filename: f, relativePath: f, abs: `${rootBasePath}/${f}` })),
        ...memFiles.map((relInsideMem) => {
          // basename for human-friendly UI display; relativePath keeps the
          // workspace-relative shape so downstream consumers (e.g. the
          // distillation service) can preserve directory structure when
          // composing memory snapshots.
          const baseName = relInsideMem.split('/').pop() ?? relInsideMem;
          return {
            filename: baseName,
            relativePath: `memory/${relInsideMem}`,
            abs: `${memBasePath}/${relInsideMem}`,
          };
        }),
      ];

      if (allPaths.length === 0) return emptyResult;

      const contents = await fileTransfer.downloadFilesBulk(
        connInfo,
        allPaths.map((p) => p.abs),
      );
      const tDownload = Date.now();
      log.info(
        {
          agentId,
          counts: { root: rootFiles.length, mem: memFiles.length },
          ms: { list: tList - t0, download: tDownload - tList, total: tDownload - t0 },
        },
        'memory-files fetch timing',
      );

      for (let i = 0; i < allPaths.length; i++) {
        const item = allPaths[i];
        const content = contents[i];
        if (content === null) {
          log.warn({ agentId, filename: item.filename }, 'Failed to download memory file');
          continue;
        }
        const contentHash = hashContent(content);
        await fileRepo.upsertFile({
          machineId: machine.id,
          relativePath: `${workspace}/${item.relativePath}`,
          content,
          contentHash,
          remoteHash: contentHash,
          remoteMtime: null,
          remoteSize: content.length,
          localDirty: false,
          remoteDirty: false,
        });
        results.push({ filename: item.filename, relativePath: item.relativePath, content });
      }

      if (results.length === 0) return emptyResult;
      await agentRepo.updateSyncTime(agent.id);

      const records = results.map((r, i) => ({
        id: `ssh-${i}`,
        relativePath: r.relativePath,
        filename: r.filename,
        content: r.content,
        category: classifyMemoryFile(r.relativePath),
        mtime: null as number | null,
        size: r.content.length,
        updatedAt: new Date(),
      }));

      return groupMemoryFiles(records);
    };

    try {
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Memory files request timeout')), REQUEST_TIMEOUT_MS),
      );
      return await Promise.race([fetchViaSSH(), timeout]);
    } catch (err) {
      if (cached.length > 0) {
        log.warn({ agentId, err }, 'SSH refresh failed, returning cached memory files');
        return { ...groupMemoryFiles(cached), stale: true };
      }
      log.warn({ agentId, err }, 'Memory files fetch timed out or failed');
      return emptyResult;
    }
  });

  // --------------------------------------------------------------------
  // --- Distill bundle endpoint --------------------------------------
  // --------------------------------------------------------------------
  // Returns a single JSON snapshot containing everything the downstream
  // platform (yuwen Mini Claw / Agents Hub) needs to materialize a
  // distilled copy of an OpenClaw agent:
  //
  //   - Agent metadata (name, description, model_config, workspace_path)
  //   - Machine context (id, name, openclaw_home — for source provenance)
  //   - All workspace markdown files (config files), keyed by filename
  //   - Full memory dump (root MEMORY.md + memory/**/*.md), keyed by
  //     relative path. Memory is grouped by category (core/daily/snapshots)
  //     so the consumer can decide whether to merge daily/snapshots.
  //   - Agent's installed skills with FULL skill_md_content from
  //     skills_catalog (so the downstream platform can upsert them into
  //     its own Skills Hub without a second round-trip).
  //
  // ---------------------------------------------------------------------
  // One-click bulk distillation → Mini Claw
  // ---------------------------------------------------------------------
  //
  // POST /api/distill/to-miniclaw
  //   body: { machineId?, refreshRemote?, includeDrafts?, onlyChanged?,
  //           maxConcurrent?, dryRun? }
  //
  // Reverse-proxies an SSE stream from Mini Claw's
  // POST /api/v1/agents-hub/openclaw/distill-all so the user can trigger
  // distillation of EVERY OpenClaw agent + all their skills with one click
  // from the clawconsole UI, with live per-agent progress.
  //
  // Required env on this clawconsole:
  //   MINICLAW_BASE_URL                 — e.g. http://localhost:8001
  //   MINICLAW_DISTILL_SERVICE_TOKEN    — must match Mini Claw's
  //                                       OPENCLAW_DISTILL_SERVICE_TOKEN
  //
  // The frontend doesn't need to know Mini Claw's location or token — it
  // talks to clawconsole only.
  fastify.post('/api/distill/to-miniclaw', async (request, reply) => {
    const body = (request.body as Record<string, unknown>) ?? {};
    const minicl = (process.env.MINICLAW_BASE_URL ?? '').replace(/\/+$/, '');
    const token = process.env.MINICLAW_DISTILL_SERVICE_TOKEN ?? '';

    if (!minicl) {
      reply.code(503);
      return { error: 'MINICLAW_BASE_URL not configured on clawconsole' };
    }
    if (!token) {
      reply.code(503);
      return { error: 'MINICLAW_DISTILL_SERVICE_TOKEN not configured on clawconsole' };
    }

    const upstreamUrl = `${minicl}/api/v1/apps/agents-hub/openclaw/distill-all`;

    let upstream: Response;
    try {
      upstream = await fetch(upstreamUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          'X-Service-Token': token,
        },
        body: JSON.stringify({
          machine_id: body.machineId ?? null,
          refresh_remote: Boolean(body.refreshRemote ?? false),
          include_drafts: Boolean(body.includeDrafts ?? false),
          only_changed: Boolean(body.onlyChanged ?? false),
          max_concurrent: Number(body.maxConcurrent ?? 3),
          dry_run: Boolean(body.dryRun ?? false),
        }),
      });
    } catch (err) {
      log.warn({ err, upstreamUrl }, 'mini-claw distill-all upstream unreachable');
      reply.code(502);
      return { error: `Mini Claw unreachable: ${(err as Error).message}` };
    }

    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text().catch(() => '');
      log.warn(
        { status: upstream.status, body: text.slice(0, 400) },
        'mini-claw distill-all rejected request',
      );
      reply.code(upstream.status);
      return { error: `Mini Claw returned ${upstream.status}: ${text.slice(0, 200)}` };
    }

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();

    // Forward the SSE stream byte-for-byte. We don't try to re-parse the
    // events — the upstream format is already SSE-compliant and the
    // frontend can consume it directly.
    request.raw.on('close', () => {
      reader.cancel().catch(() => undefined);
    });

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) reply.raw.write(decoder.decode(value, { stream: true }));
      }
    } catch (err) {
      log.warn({ err }, 'distill SSE stream interrupted');
    } finally {
      try {
        reply.raw.end();
      } catch {
        /* connection already gone */
      }
    }
    return reply;
  });

  // ---------------------------------------------------------------------
  // One-click SINGLE-bot distillation → Mini Claw
  // ---------------------------------------------------------------------
  //
  // POST /api/distill/to-miniclaw/single
  //   body: { machineId, agentId,
  //           agentKeyOverride?, department?, profession?, extraTags?,
  //           refreshRemote?, dryRun? }
  //
  // Counterpart to /api/distill/to-miniclaw (which is the bulk SSE variant).
  // This one is a plain JSON request/response — the user clicks "蒸馏到 Mini
  // Claw" inside the bot preview modal, we forward to Mini Claw's single-
  // agent endpoint with the service token, and pass the JSON summary back.
  //
  // Reuses the same env vars as the bulk proxy:
  //   MINICLAW_BASE_URL                 — e.g. http://localhost:8001
  //   MINICLAW_DISTILL_SERVICE_TOKEN    — must match Mini Claw's
  //                                       OPENCLAW_DISTILL_SERVICE_TOKEN
  fastify.post('/api/distill/to-miniclaw/single', async (request, reply) => {
    const body = (request.body as Record<string, unknown>) ?? {};
    const minicl = (process.env.MINICLAW_BASE_URL ?? '').replace(/\/+$/, '');
    const token = process.env.MINICLAW_DISTILL_SERVICE_TOKEN ?? '';

    if (!minicl) {
      reply.code(503);
      return { error: 'MINICLAW_BASE_URL not configured on clawconsole' };
    }
    if (!token) {
      reply.code(503);
      return { error: 'MINICLAW_DISTILL_SERVICE_TOKEN not configured on clawconsole' };
    }

    const machineId = typeof body.machineId === 'string' ? body.machineId.trim() : '';
    const agentId = typeof body.agentId === 'string' ? body.agentId.trim() : '';
    if (!machineId || !agentId) {
      reply.code(400);
      return { error: 'machineId and agentId are required' };
    }

    const upstreamUrl = `${minicl}/api/v1/apps/agents-hub/openclaw/distill`;
    const payload = {
      machine_id: machineId,
      agent_id: agentId,
      agent_key_override:
        typeof body.agentKeyOverride === 'string' && body.agentKeyOverride.trim()
          ? body.agentKeyOverride.trim()
          : null,
      department: typeof body.department === 'string' ? body.department : '',
      profession: typeof body.profession === 'string' ? body.profession : '',
      extra_tags: Array.isArray(body.extraTags) ? body.extraTags : [],
      refresh_remote: Boolean(body.refreshRemote ?? false),
      dry_run: Boolean(body.dryRun ?? false),
    };

    let upstream: Response;
    try {
      upstream = await fetch(upstreamUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Service-Token': token,
        },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      log.warn({ err, upstreamUrl }, 'mini-claw single distill upstream unreachable');
      reply.code(502);
      return { error: `Mini Claw unreachable: ${(err as Error).message}` };
    }

    const text = await upstream.text();
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = { error: `Mini Claw returned non-JSON (HTTP ${upstream.status}): ${text.slice(0, 400)}` };
    }

    if (!upstream.ok) {
      log.warn(
        { status: upstream.status, body: text.slice(0, 400) },
        'mini-claw single distill rejected request',
      );
    }
    reply.code(upstream.status);
    return parsed;
  });

  // The endpoint reads from the local clawconsole DB cache. Callers that
  // need the absolute latest content should hit `/config-files?refresh=true`
  // and `/memory-files?refresh=true` first to repopulate the cache, then
  // call this endpoint. Doing the SSH refresh inline here would couple
  // distillation to remote machine availability.
  fastify.get('/api/machines/:machineId/agents/:agentId/distill-bundle', async (request) => {
    const { machineId, agentId } = request.params as {
      machineId: string;
      agentId: string;
    };

    const agent = await agentRepo.findById(agentId);
    if (!agent) throw new AppError('Agent not found', 'NOT_FOUND', 404);
    if (agent.machineId !== machineId) {
      throw new AppError('Agent does not belong to this machine', 'VALIDATION_ERROR', 400);
    }

    const machine = await machineRepo.findById(machineId);
    if (!machine) throw new AppError('Machine not found', 'NOT_FOUND', 404);

    const workspace = agent.workspacePath ?? 'workspace';

    // Workspace markdown / config files (DB cache only — the caller is
    // expected to have refreshed them before invoking distillation).
    const configRows = await fileRepo.findConfigFilesByWorkspace(machine.id, workspace);
    const configFiles: Record<string, string> = {};
    for (const row of configRows) {
      configFiles[row.filename] = row.content;
    }

    // Memory files: grouped by category so the consumer can apply
    // different merge strategies (e.g. always include core, sample
    // recent daily, drop snapshots).
    const memoryRows = await fileRepo.findMemoryFilesByAgent(machine.id, workspace);
    const memoryFilesByPath: Record<string, string> = {};
    const memoryByCategory: { core: Array<{ path: string; content: string }>; daily: Array<{ path: string; content: string }>; sessionSnapshots: Array<{ path: string; content: string }> } = {
      core: [],
      daily: [],
      sessionSnapshots: [],
    };
    for (const row of memoryRows) {
      memoryFilesByPath[row.relativePath] = row.content;
      const entry = { path: row.relativePath, content: row.content };
      if (row.category === 'core') memoryByCategory.core.push(entry);
      else if (row.category === 'daily') memoryByCategory.daily.push(entry);
      else memoryByCategory.sessionSnapshots.push(entry);
    }

    // Skills associated with this agent + their FULL skill markdown.
    //
    // Source UNION (in priority order — first wins on key collision):
    //
    //   1. agent_skills relational table (user explicitly installed via UI).
    //      Carries real install metadata (scope, configOverrides, install time).
    //   2. agents.discovered_skills JSON list (auto-detected from filesystem
    //      scan of the agent's workspace ~/.claude/skills/). Most agents only
    //      live in this column — agent_skills is sparsely populated. Without
    //      this fallback, distill-bundle returned 0 skills for ~all agents
    //      and downstream platforms (Mini Claw / Skills Hub) had no way to
    //      ingest the agent's actual skills. We synthesize a minimal install
    //      record (enabled=true, scope='agent') so the downstream upsert
    //      treats them like first-class installs.
    //
    // The full skill_md_content always comes from skills_catalog so the
    // downstream consumer can upsert into its own skills table.
    type SkillBundleEntry = {
      install: { scope: string; enabled: boolean; configOverrides: unknown; installedAt: string };
      skill: {
        skillKey: string;
        name: string;
        description: string | null;
        scope: unknown;
        source: unknown;
        version: string | null;
        skillMdContent: string | null;
        auxiliaryFiles: unknown;
        requiresBins: unknown;
        requiresEnv: unknown;
        tags: unknown;
        reviewStatus: unknown;
      };
    };

    const skillsByKey = new Map<string, SkillBundleEntry>();

    const installedSkills = await skillRepo.findAgentSkills(agent.id);
    for (const install of installedSkills) {
      const k = install.skill.skillKey;
      if (!k) continue;
      skillsByKey.set(k, {
        install: {
          scope: install.scope,
          enabled: install.enabled,
          configOverrides: install.configOverrides,
          installedAt: install.installedAt.toISOString(),
        },
        skill: {
          skillKey: k,
          name: install.skill.name,
          description: install.skill.description,
          scope: install.skill.scope,
          source: install.skill.source,
          version: install.skill.version,
          skillMdContent: install.skill.skillMdContent,
          auxiliaryFiles: install.skill.auxiliaryFiles,
          requiresBins: install.skill.requiresBins,
          requiresEnv: install.skill.requiresEnv,
          tags: install.skill.tags,
          reviewStatus: install.skill.reviewStatus,
        },
      });
    }

    const discoveredKeys: string[] = Array.isArray(agent.discoveredSkills)
      ? (agent.discoveredSkills as string[])
      : [];
    const installedAtFallback = (agent.lastSyncedAt ?? new Date()).toISOString();

    let discoveredAdded = 0;
    let discoveredMissing = 0;
    for (const key of discoveredKeys) {
      const k = (key ?? '').trim();
      if (!k || skillsByKey.has(k)) continue;
      const catalog = await skillRepo.findByKey(k);
      if (!catalog) {
        // The agent's filesystem references a skill that's never been
        // catalogued in clawconsole. Surface it in logs but skip — there's
        // no markdown content to ship.
        discoveredMissing += 1;
        log.warn({ agentId: agent.id, skillKey: k }, 'discovered skill missing from skills_catalog');
        continue;
      }
      skillsByKey.set(k, {
        install: {
          scope: 'agent',
          enabled: true,
          configOverrides: null,
          installedAt: installedAtFallback,
        },
        skill: {
          skillKey: catalog.skillKey,
          name: catalog.name,
          description: catalog.description,
          scope: catalog.scope,
          source: catalog.source,
          version: catalog.version,
          skillMdContent: catalog.skillMdContent,
          auxiliaryFiles: catalog.auxiliaryFiles,
          requiresBins: catalog.requiresBins,
          requiresEnv: catalog.requiresEnv,
          tags: catalog.tags,
          reviewStatus: catalog.reviewStatus,
        },
      });
      discoveredAdded += 1;
    }

    const skills = Array.from(skillsByKey.values());
    log.info(
      {
        agentId: agent.id,
        installedCount: installedSkills.length,
        discoveredKeysCount: discoveredKeys.length,
        discoveredAdded,
        discoveredMissing,
        finalSkillsCount: skills.length,
      },
      'distill-bundle skills assembled',
    );

    return {
      bundleVersion: 1,
      generatedAt: new Date().toISOString(),
      machine: {
        id: machine.id,
        name: machine.name,
        hostname: machine.tailscaleHostname,
        openclawHome: machine.openclawHome,
        discoveredSkills: machine.discoveredSkills ?? [],
      },
      agent: {
        id: agent.id,
        agentId: agent.agentId,
        name: agent.name,
        description: agent.description,
        isDefault: agent.isDefault,
        workspacePath: workspace,
        discoveredSkills: agent.discoveredSkills ?? [],
        modelConfig: agent.modelConfig,
        status: agent.status,
        lastSyncedAt: agent.lastSyncedAt?.toISOString() ?? null,
      },
      workspace: {
        configFiles,
        configFileNames: Object.keys(configFiles).sort(),
      },
      memory: {
        files: memoryFilesByPath,
        byCategory: memoryByCategory,
        totalFiles: memoryRows.length,
      },
      skills,
    };
  });

  // --- Provision endpoint (SSE for bot deployment progress) ---
  fastify.post('/api/agents/:agentId/provision', async (request, reply) => {
    const { agentId } = request.params as { agentId: string };
    const body = request.body as {
      channels?: Array<{
        channelType: string;
        accountId: string;
        token?: string;
        signingSecret?: string;
        encryptKey?: string;
      }>;
      copyFromAgentId?: string;
    };

    const agent = await agentRepo.findById(agentId);
    if (!agent) throw new AppError('Agent not found', 'NOT_FOUND', 404);
    const provisionableStatuses = ['draft', 'packaging', 'offline'];
    if (!provisionableStatuses.includes(agent.status)) {
      throw new AppError(
        `Agent must be in draft/packaging/offline status to provision (current: ${agent.status})`,
        'VALIDATION_ERROR',
        400,
      );
    }

    const machine = await machineRepo.findById(agent.machineId);
    if (!machine) throw new AppError('Machine not found', 'NOT_FOUND', 404);

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    const sendEvent = (step: string, status: string, message: string, detail?: string) => {
      const data = JSON.stringify({ step, status, message, detail });
      reply.raw.write(`data: ${data}\n\n`);
    };

    // Safely parse a skill result string; returns { success: false } for
    // plain error strings that aren't valid JSON.
    const parseSkillResult = (raw: string): { success: boolean; [k: string]: unknown } => {
      if (raw.startsWith('Error')) return { success: false, message: raw };
      try {
        return JSON.parse(raw);
      } catch {
        return { success: false, message: raw };
      }
    };

    try {
      // Step 1: Create agent on remote machine (skip for default agents — they already exist)
      if (agent.isDefault) {
        sendEvent('create_agent', 'success', 'Default agent already exists on remote machine, skipping creation');
        await agentRepo.update(agentId, { status: 'packaging' });
      } else {
        sendEvent('create_agent', 'running', 'Creating agent on remote machine...');
        const createResult = await platformSkills.get('create_agent_on_node')!
          .handler({
            machineId: agent.machineId,
            agentId: agent.agentId,
            dbRecordId: agent.id,
            workspace: agent.workspacePath ?? `workspace-${agent.agentId}`,
          }, platformSkills.getContext());
        const createParsed = parseSkillResult(createResult);
        if (!createParsed.success) {
          sendEvent('create_agent', 'error', String(createParsed.message ?? createResult));
          await agentRepo.update(agentId, { status: 'draft' }).catch(() => {});
          reply.raw.end();
          return;
        }
        sendEvent('create_agent', 'success', 'Agent created on remote machine');
      }

      // Step 2: Configure channels (if any)
      const channels = body.channels ?? [];
      for (const ch of channels) {
        sendEvent('configure_channel', 'running', `Configuring ${ch.channelType}:${ch.accountId}...`);
        const chResult = await platformSkills.get('configure_channel')!
          .handler({
            machineId: agent.machineId,
            channelType: ch.channelType,
            accountId: ch.accountId,
            token: ch.token,
            signingSecret: ch.signingSecret,
            encryptKey: ch.encryptKey,
          }, platformSkills.getContext());
        const chParsed = parseSkillResult(chResult);
        if (!chParsed.success && !chParsed.requiresInteractiveSetup) {
          sendEvent('configure_channel', 'error', String(chParsed.message ?? chResult));
          continue;
        }
        sendEvent('configure_channel', 'success', `Channel ${ch.channelType}:${ch.accountId} configured`);

        // Step 3: Bind channel to agent (skip for interactive-only channels)
        if (!chParsed.requiresInteractiveSetup) {
          sendEvent('bind_channel', 'running', `Binding ${ch.channelType}:${ch.accountId} to agent...`);
          const bindResult = await platformSkills.get('bind_channel_to_agent')!
            .handler({
              machineId: agent.machineId,
              agentId: agent.agentId,
              bindings: `${ch.channelType}:${ch.accountId}`,
            }, platformSkills.getContext());
          const bindParsed = parseSkillResult(bindResult);
          if (!bindParsed.success) {
            sendEvent('bind_channel', 'error', String(bindParsed.message ?? bindResult));
          } else {
            sendEvent('bind_channel', 'success', `Channel bound to agent`);
          }
        }
      }

      // Step 4: Deploy agent
      sendEvent('deploy', 'running', 'Deploying agent and restarting gateway...');
      const deployResult = await platformSkills.get('deploy_agent')!
        .handler({
          machineId: agent.machineId,
          agentId: agent.agentId,
          dbRecordId: agent.id,
          identityName: agent.name || agent.agentId,
        }, platformSkills.getContext());
      const deployParsed = parseSkillResult(deployResult);
      if (!deployParsed.success) {
        sendEvent('deploy', 'error', String(deployParsed.message ?? deployResult));
        await agentRepo.update(agentId, { status: 'draft' }).catch(() => {});
        reply.raw.end();
        return;
      }
      sendEvent('deploy', 'success', 'Agent deployed successfully');

      // Step 5 (optional): Copy config files from source bot
      if (body.copyFromAgentId) {
        sendEvent('copy_config', 'running', 'Copying configuration from source bot...');
        try {
          const sourceAgent = await agentRepo.findById(body.copyFromAgentId);
          if (!sourceAgent) {
            sendEvent('copy_config', 'error', 'Source bot not found');
          } else {
            const sourceMachine = await machineRepo.findById(sourceAgent.machineId);
            if (!sourceMachine) {
              sendEvent('copy_config', 'error', 'Source bot machine not found');
            } else {
              const sourceWorkspace = sourceAgent.workspacePath ?? 'workspace';
              const targetWorkspace = agent.workspacePath ?? 'workspace';

              // Read config files from source (DB cache first, then SSH)
              let configFiles: Array<{ filename: string; content: string }> = [];
              const cachedFiles = await fileRepo.findConfigFilesByWorkspace(sourceMachine.id, sourceWorkspace);
              if (cachedFiles.length > 0) {
                configFiles = cachedFiles.map(({ filename, content }) => ({ filename, content }));
              } else {
                const sourceConnInfo = machineService.toConnectionInfo(sourceMachine);
                const { stdout } = await sshPool.executeCommand(
                  sourceConnInfo,
                  `cd ${sourceMachine.openclawHome}/${sourceWorkspace} && pwd && ls -1 *.md 2>/dev/null`,
                  { timeoutMs: 10_000 },
                );
                const lines = stdout.split('\n').filter(Boolean);
                if (lines.length > 1) {
                  const absBasePath = lines[0];
                  for (const filename of lines.slice(1)) {
                    try {
                      const content = await fileTransfer.downloadFile(sourceConnInfo, `${absBasePath}/${filename}`);
                      configFiles.push({ filename, content });
                    } catch {
                      log.warn({ filename }, 'Failed to read source config file');
                    }
                  }
                }
              }

              // Write config files to target workspace
              if (configFiles.length > 0) {
                const targetConnInfo = machineService.toConnectionInfo(machine);
                const targetDir = `${machine.openclawHome}/${targetWorkspace}`;
                let copiedCount = 0;
                for (const { filename, content } of configFiles) {
                  try {
                    await fileTransfer.uploadFile(targetConnInfo, `${targetDir}/${filename}`, content);
                    const contentHash = hashContent(content);
                    await fileRepo.upsertFile({
                      machineId: machine.id,
                      relativePath: `${targetWorkspace}/${filename}`,
                      content,
                      contentHash,
                      remoteHash: contentHash,
                      remoteMtime: null,
                      remoteSize: content.length,
                      localDirty: false,
                      remoteDirty: false,
                    });
                    copiedCount++;
                  } catch (fileErr) {
                    log.warn({ filename, err: fileErr }, 'Failed to copy config file to target');
                  }
                }
                sendEvent('copy_config', 'success', `Copied ${copiedCount} config file(s) from source bot`);
              } else {
                sendEvent('copy_config', 'success', 'No config files found in source bot');
              }

              // Copy model config if source has one
              if (sourceAgent.modelConfig) {
                try {
                  await agentRepo.update(agentId, { modelConfig: sourceAgent.modelConfig });
                  sendEvent('copy_model_config', 'success', 'Model config copied from source bot');
                } catch {
                  sendEvent('copy_model_config', 'error', 'Failed to copy model config');
                }
              }
            }
          }
        } catch (copyErr) {
          const copyMsg = copyErr instanceof Error ? copyErr.message : String(copyErr);
          sendEvent('copy_config', 'error', `Failed to copy config: ${copyMsg}`);
        }
      }

      sendEvent('done', 'success', 'Provisioning complete');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendEvent('error', 'error', message);
      await agentRepo.update(agentId, { status: 'draft' }).catch(() => {});
    } finally {
      reply.raw.end();
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
  // SSH-heavy jobs use concurrency 1 to avoid saturating the per-machine connection pool.
  // Each worker is gated by the same *_ENABLED flag as its scheduler, so disabling a
  // job both stops the recurring schedule and prevents any manual/leftover queue
  // entries from being processed.
  if (config.jobs.healthCheckEnabled) {
    createWorker('health-check', createHealthCheckHandler(machineService, gatewayPool), { concurrency: 1 });
  }
  if (config.jobs.autoPullEnabled) {
    createWorker('auto-pull', createAutoPullHandler(machineService, syncEngine), { concurrency: 1 });
  }
  if (config.jobs.syncRetryEnabled) {
    createWorker('sync-retry', createSyncRetryHandler(machineService, syncEngine, syncRepo), { concurrency: 1 });
  }
  if (config.jobs.sessionSyncEnabled) {
    createWorker('session-sync', createSessionSyncHandler(monitoringService), { concurrency: 1 });
  }
  if (config.jobs.logCollectorEnabled) {
    createWorker('log-collector', createLogCollectorHandler(monitoringService), { concurrency: 1 });
  }
  if (config.jobs.evoClawEnabled) {
    createWorker('evo-claw', createEvoClawHandler(ecaService, agentRepo, machineRepo), { concurrency: 1 });
  }
  if (config.jobs.summaryEnabled) {
    // concurrency 1: the job iterates all bots serially and each bot hits
    // Gemini + Feishu; we don't want overlapping runs producing duplicate
    // rows in the same 12h window.
    createWorker('summary', createSummaryHandler(summaryService), { concurrency: 1 });
  }
  if (config.jobs.dailyOssBackupEnabled) {
    // BullMQ worker concurrency is 1 — the handler itself fans out to
    // ``config.dailyOssBackup.concurrency`` parallel pushes internally,
    // so the worker just needs to consume one scheduled tick at a time.
    createWorker(
      'daily-oss-backup',
      createDailyOssBackupHandler({ machineRepo, agentRepo, distillPushService }),
      { concurrency: 1 },
    );
  }

  // Manual / on-demand distill queue. One job per agent; the worker fans
  // out by running multiple jobs in parallel (concurrency = same setting
  // as daily backup, since both saturate the same SSH/SFTP/OSS path).
  // No enable flag — this queue is the only path the routes use, so
  // turning it off would break the UI's distill button.
  createWorker(
    'manual-oss-distill',
    createManualOssDistillHandler({ distillPushService }),
    { concurrency: config.dailyOssBackup.concurrency },
  );

  // --- Agent Config endpoint (centralized agent registry) ---
  fastify.get('/api/agent-configs', async () => {
    const configs = getAllAgentConfigs().map(({ systemPrompt, ...rest }) => ({
      ...rest,
      systemPromptLength: systemPrompt.length,
    }));
    return { data: configs, total: configs.length };
  });

  fastify.get('/api/agent-configs/:agentConfigId', async (request) => {
    const { agentConfigId } = request.params as { agentConfigId: string };
    try {
      const { getAgentConfig } = await import('./shared/langgraph/agent-config.js');
      const cfg = getAgentConfig(agentConfigId as any);
      return cfg;
    } catch {
      throw new AppError('Agent config not found', 'NOT_FOUND', 404);
    }
  });

  // --- Model Config endpoints (agent-level) ---

  fastify.get('/api/agents/:agentId/model-config', async (request) => {
    const { agentId } = request.params as { agentId: string };
    const agent = await agentRepo.findById(agentId);
    if (!agent) throw new AppError('Agent not found', 'NOT_FOUND', 404);

    return {
      modelConfig: agent.modelConfig,
      agentId: agent.agentId,
    };
  });

  fastify.put('/api/agents/:agentId/model-config', async (request) => {
    const { agentId } = request.params as { agentId: string };
    const body = request.body as { model: string | { primary: string; fallbacks?: string[] } };

    const agent = await agentRepo.findById(agentId);
    if (!agent) throw new AppError('Agent not found', 'NOT_FOUND', 404);

    if (!body.model) {
      throw new AppError('model is required', 'VALIDATION_ERROR', 400);
    }

    const modelConfig = { model: body.model };
    await agentRepo.updateModelConfig(agentId, modelConfig);
    const updated = await agentRepo.findById(agentId);
    return { modelConfig: updated?.modelConfig };
  });

  fastify.post('/api/agents/:agentId/model-config/sync', async (request) => {
    const { agentId } = request.params as { agentId: string };
    const agent = await agentRepo.findById(agentId);
    if (!agent) throw new AppError('Agent not found', 'NOT_FOUND', 404);

    if (!agent.modelConfig?.model) {
      throw new AppError('No model configured for this agent', 'VALIDATION_ERROR', 400);
    }

    await modelConfigService.syncAgentModel(
      agent.machineId,
      agent.agentId,
      agent.id,
      agent.modelConfig.model,
    );

    const updated = await agentRepo.findById(agentId);
    return { modelConfig: updated?.modelConfig, synced: true };
  });

  fastify.delete('/api/agents/:agentId/model-config', async (request, reply) => {
    const { agentId } = request.params as { agentId: string };
    const agent = await agentRepo.findById(agentId);
    if (!agent) throw new AppError('Agent not found', 'NOT_FOUND', 404);

    await modelConfigService.removeAgentModel(agent.machineId, agent.agentId, agent.id);
    return reply.status(204).send();
  });

  // --- Model Config endpoints (machine/global level) ---

  fastify.get('/api/machines/:machineId/model-config', async (request) => {
    const { machineId } = request.params as { machineId: string };
    const machine = await machineRepo.findById(machineId);
    if (!machine) throw new AppError('Machine not found', 'NOT_FOUND', 404);

    return { modelConfig: machine.modelConfig };
  });

  fastify.get('/api/machines/:machineId/model-config/remote', async (request) => {
    const { machineId } = request.params as { machineId: string };
    const machine = await machineRepo.findById(machineId);
    if (!machine) throw new AppError('Machine not found', 'NOT_FOUND', 404);

    const remote = await modelConfigService.readRemoteConfig(machineId);
    return remote;
  });

  fastify.put('/api/machines/:machineId/model-config', async (request) => {
    const { machineId } = request.params as { machineId: string };
    const body = request.body as { model: string | { primary: string; fallbacks?: string[] } };

    const machine = await machineRepo.findById(machineId);
    if (!machine) throw new AppError('Machine not found', 'NOT_FOUND', 404);

    if (!body.model) {
      throw new AppError('model is required', 'VALIDATION_ERROR', 400);
    }

    const modelConfig = { model: body.model };
    await machineRepo.updateModelConfig(machineId, modelConfig);
    const updated = await machineRepo.findById(machineId);
    return { modelConfig: updated?.modelConfig };
  });

  fastify.post('/api/machines/:machineId/model-config/sync', async (request) => {
    const { machineId } = request.params as { machineId: string };
    const machine = await machineRepo.findById(machineId);
    if (!machine) throw new AppError('Machine not found', 'NOT_FOUND', 404);

    if (!machine.modelConfig?.model) {
      throw new AppError('No model configured for this machine', 'VALIDATION_ERROR', 400);
    }

    await modelConfigService.syncGlobalModel(machineId, machine.modelConfig.model);

    const updated = await machineRepo.findById(machineId);
    return { modelConfig: updated?.modelConfig, synced: true };
  });

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
    await closeAllBrowsers();
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

    // Auto-connect gateway WebSocket for all online machines.
    // Skipped when GATEWAY_CONNECTOR_ENABLED=false to avoid reconnect-loop
    // log spam when the remote gateway service is not running.
    if (config.gateway.connectorEnabled) {
      // directConnect (public-IP/Docker) machines are managed over HTTP
      // admin-http-rpc, not the WebSocket pool, so exclude them here.
      const onlineMachines = (await machineService.listMachines({ status: 'online' }))
        .filter((m) => !m.directConnect);
      for (const machine of onlineMachines) {
        gatewayPool.addMachine({
          machineId: machine.id,
          host: machine.tailscaleHostname,
          port: machine.gatewayPort ?? config.gateway.defaultPort,
        });
      }
      if (onlineMachines.length > 0) {
        log.info({ count: onlineMachines.length }, 'Gateway connections initiated for online machines');
      }
    } else {
      log.info('Gateway connector disabled (GATEWAY_CONNECTOR_ENABLED=false)');
    }
  } catch (err) {
    log.error({ err }, 'Failed to start server');
    process.exit(1);
  }
}

main();
