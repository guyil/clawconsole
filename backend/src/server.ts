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

import { PlatformSkillRegistry, allPlatformSkills } from './shared/platform-skills/index.js';
import { classifyMemoryFile, type MemoryFileRecord } from './shared/memory-classifier.js';
import { hashContent } from './shared/crypto.js';

import { setupRecurringJobs, createWorker } from './jobs/queue.js';
import { createHealthCheckHandler } from './jobs/health-check.job.js';
import { createAutoPullHandler } from './jobs/auto-pull.job.js';
import { createSyncRetryHandler } from './jobs/sync-retry.job.js';
import { createSessionSyncHandler } from './jobs/session-sync.job.js';
import { createLogCollectorHandler } from './jobs/log-collector.job.js';

const log = createChildLogger('server');

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

          // Write-through: persist to DB cache so subsequent requests avoid SSH
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

    // SSH fallback with request-level timeout (20s) to avoid hanging when
    // SSH pool is contended by background jobs
    const REQUEST_TIMEOUT_MS = 20_000;

    const fetchViaSSH = async () => {
      const connInfo = machineService.toConnectionInfo(machine);
      const wsDir = `${machine.openclawHome}/${workspace}`;
      const results: Array<{ filename: string; relativePath: string; content: string }> = [];

      // Step 1: List root-level memory files (same pattern as config-files)
      const { stdout: rootStdout } = await sshPool.executeCommand(
        connInfo,
        `cd ${wsDir} && pwd && ls -1 MEMORY.md memory.md 2>/dev/null`,
        { timeoutMs: 10_000 },
      );
      const rootLines = rootStdout.split('\n').filter(Boolean);
      const rootBasePath = rootLines[0] ?? '';
      const rootFiles = rootLines.slice(1);

      for (const filename of rootFiles) {
        try {
          const content = await fileTransfer.downloadFile(connInfo, `${rootBasePath}/${filename}`);
          results.push({ filename, relativePath: filename, content });

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
        } catch {
          log.warn({ agentId, filename }, 'Failed to download root memory file');
        }
      }

      // Step 2: List memory/ directory files
      try {
        const { stdout: memStdout } = await sshPool.executeCommand(
          connInfo,
          `cd ${wsDir}/memory && pwd && ls -1 *.md 2>/dev/null`,
          { timeoutMs: 10_000 },
        );
        const memLines = memStdout.split('\n').filter(Boolean);
        const memBasePath = memLines[0] ?? '';
        const memFiles = memLines.slice(1);

        for (const filename of memFiles) {
          try {
            const content = await fileTransfer.downloadFile(connInfo, `${memBasePath}/${filename}`);
            results.push({
              filename,
              relativePath: `memory/${filename}`,
              content,
            });

            const contentHash = hashContent(content);
            await fileRepo.upsertFile({
              machineId: machine.id,
              relativePath: `${workspace}/memory/${filename}`,
              content,
              contentHash,
              remoteHash: contentHash,
              remoteMtime: null,
              remoteSize: content.length,
              localDirty: false,
              remoteDirty: false,
            });
          } catch {
            log.warn({ agentId, filename }, 'Failed to download memory dir file');
          }
        }
      } catch {
        log.debug({ agentId }, 'No memory/ directory or not accessible');
      }

      if (results.length === 0) return emptyResult;

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
  // SSH-heavy jobs use concurrency 1 to avoid saturating the per-machine connection pool
  createWorker('health-check', createHealthCheckHandler(machineService, gatewayPool), { concurrency: 1 });
  createWorker('auto-pull', createAutoPullHandler(machineService, syncEngine), { concurrency: 1 });
  createWorker('sync-retry', createSyncRetryHandler(machineService, syncEngine, syncRepo), { concurrency: 1 });
  createWorker('session-sync', createSessionSyncHandler(monitoringService), { concurrency: 1 });
  createWorker('log-collector', createLogCollectorHandler(monitoringService), { concurrency: 1 });

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
