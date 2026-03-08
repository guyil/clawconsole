import { v4 as uuidv4 } from 'uuid';
import { buildAgent, streamAgent, closeBrowser, getAgentConfig } from '../../shared/langgraph/index.js';
import type { StreamEvent } from '../../shared/langgraph/types.js';
import { createChildLogger } from '../../shared/logger.js';
import { NotFoundError, AppError } from '../../shared/errors.js';
import { buildConfigTools } from './bot-config-agent.tools.js';
import type {
  ConfigChatSession,
  PendingChange,
  SyncConfigResult,
} from './bot-config-agent.types.js';
import type { AgentRepository } from '../agents/agent.repository.js';
import type { FileRepository } from '../files/file.repository.js';
import type { MachineService } from '../machines/machine.service.js';
import type { SyncEngine } from '../sync/sync-engine.js';
import type { SSHPool } from '../../transport/ssh-pool.js';
import type { FileTransfer } from '../../transport/file-transfer.js';

const log = createChildLogger('bot-config-agent');

const agentCfg = getAgentConfig('bot-config');

/** Max idle time before a session is cleaned up (30 minutes) */
const SESSION_TTL_MS = 30 * 60 * 1000;

export interface BotConfigAgentDeps {
  agentRepo: AgentRepository;
  fileRepo: FileRepository;
  machineService: MachineService;
  syncEngine: SyncEngine;
  sshPool: SSHPool;
  fileTransfer: FileTransfer;
}

export class BotConfigAgentService {
  private sessions = new Map<string, ConfigChatSession>();
  private agentRepo: AgentRepository;
  private fileRepo: FileRepository;
  private machineService: MachineService;
  private syncEngine: SyncEngine;
  private sshPool: SSHPool;
  private fileTransfer: FileTransfer;

  constructor(deps: BotConfigAgentDeps) {
    this.agentRepo = deps.agentRepo;
    this.fileRepo = deps.fileRepo;
    this.machineService = deps.machineService;
    this.syncEngine = deps.syncEngine;
    this.sshPool = deps.sshPool;
    this.fileTransfer = deps.fileTransfer;
  }

  /**
   * Gets or creates a config chat session for the given agent.
   * Loads config files from the local DB cache first; falls back to SSH
   * only when no cached files exist (first sync or empty DB).
   */
  async getOrCreateSession(agentId: string): Promise<ConfigChatSession> {
    // Reuse existing active session
    for (const session of this.sessions.values()) {
      if (session.agentId === agentId && session.status === 'active') {
        session.lastActivityAt = new Date();
        return session;
      }
    }

    const agent = await this.agentRepo.findById(agentId);
    if (!agent) throw new NotFoundError('Agent', agentId);

    const machine = await this.machineService.getMachine(agent.machineId);
    const workspace = agent.workspacePath ?? 'workspace';

    const files = new Map<string, { filename: string; originalContent: string; currentContent: string; dirty: boolean }>();

    // Try loading from local DB cache first
    const cachedFiles = await this.fileRepo.findConfigFilesByWorkspace(machine.id, workspace);
    if (cachedFiles.length > 0) {
      for (const cached of cachedFiles) {
        files.set(cached.filename, {
          filename: cached.filename,
          originalContent: cached.content,
          currentContent: cached.content,
          dirty: false,
        });
      }
      log.info({ agentId, fileCount: files.size }, 'Loaded config files from DB cache');
    } else {
      // Fallback: load from remote machine via SSH (first time / empty cache)
      try {
        const connInfo = this.machineService.toConnectionInfo(machine);
        const { stdout } = await this.sshPool.executeCommand(
          connInfo,
          `cd ${machine.openclawHome}/${workspace} && pwd && ls -1 *.md 2>/dev/null`,
          { timeoutMs: 10_000 },
        );
        const lines = stdout.split('\n').filter(Boolean);
        if (lines.length > 0) {
          const absBasePath = lines[0];
          const filenames = lines.slice(1);
          for (const filename of filenames) {
            try {
              const content = await this.fileTransfer.downloadFile(connInfo, `${absBasePath}/${filename}`);
              files.set(filename, {
                filename,
                originalContent: content,
                currentContent: content,
                dirty: false,
              });
            } catch {
              log.warn({ agentId, filename }, 'Failed to download config file');
            }
          }
        }
      } catch (err) {
        log.error({ err, agentId }, 'Failed to load config files from remote');
        throw new AppError('Failed to connect to remote machine to load config files', 'SSH_ERROR', 502);
      }
    }

    const session: ConfigChatSession = {
      id: uuidv4(),
      agentId,
      machineId: agent.machineId,
      status: 'active',
      messages: [],
      workspacePath: workspace,
      files,
      createdAt: new Date(),
      lastActivityAt: new Date(),
    };

    this.sessions.set(session.id, session);
    this.scheduleCleanup(session.id);

    log.info({ sessionId: session.id, agentId, fileCount: files.size }, 'Config chat session created');
    return session;
  }

  /**
   * Streams a chat response for the given agent.
   * Automatically creates/reuses a session.
   */
  async *chat(agentId: string, userMessage: string): AsyncGenerator<StreamEvent> {
    const session = await this.getOrCreateSession(agentId);
    session.lastActivityAt = new Date();

    session.messages.push({ role: 'user', content: userMessage });

    const tools = buildConfigTools(session);
    const compiledGraph = buildAgent({
      model: agentCfg.model,
      systemPrompt: agentCfg.systemPrompt,
      tools,
      maxTokens: agentCfg.maxTokens,
      temperature: agentCfg.temperature,
    });

    const existingMessages = session.messages.slice(0, -1).map((m) => ({
      role: m.role,
      content: m.content,
    }));

    let assistantContent = '';
    for await (const event of streamAgent(compiledGraph, userMessage, existingMessages, {
      agentId: 'bot-config',
      sessionId: session.id,
    })) {
      yield event;
      if (event.type === 'text-delta') {
        assistantContent = event.data.content as string;
      }
    }

    if (assistantContent) {
      session.messages.push({ role: 'assistant', content: assistantContent });
    }
  }

  /**
   * Returns pending (dirty) changes for the agent's session.
   */
  async getPendingChanges(agentId: string): Promise<PendingChange[]> {
    const session = this.findSessionByAgent(agentId);
    if (!session) return [];

    const changes: PendingChange[] = [];
    for (const [filename, snap] of session.files) {
      if (!snap.dirty) continue;

      // Try to find managed file ID
      const managedFile = await this.fileRepo.findByPath(
        session.machineId,
        `${session.workspacePath}/${filename}`,
      );

      changes.push({
        filename,
        originalContent: snap.originalContent,
        currentContent: snap.currentContent,
        managedFileId: managedFile?.id ?? null,
      });
    }
    return changes;
  }

  /**
   * Writes pending changes to the managed_files DB and triggers a push sync
   * to the remote machine.
   */
  async syncChanges(agentId: string): Promise<SyncConfigResult> {
    const session = this.findSessionByAgent(agentId);
    if (!session) {
      return { syncedFiles: 0, failedFiles: 0, errors: ['No active session found'] };
    }

    const dirtyFiles = [...session.files.entries()].filter(([, snap]) => snap.dirty);
    if (dirtyFiles.length === 0) {
      return { syncedFiles: 0, failedFiles: 0, errors: [] };
    }

    const machine = await this.machineService.getMachine(session.machineId);
    const connInfo = this.machineService.toConnectionInfo(machine);

    // Persist each dirty file into managed_files with local_dirty = true
    const relativePaths: string[] = [];
    for (const [filename, snap] of dirtyFiles) {
      const relativePath = `${session.workspacePath}/${filename}`;
      relativePaths.push(relativePath);

      await this.fileRepo.upsertFile({
        machineId: session.machineId,
        relativePath,
        content: snap.currentContent,
        contentHash: null, // will be computed by upsertFile or sync
        remoteHash: null,
        remoteMtime: null,
        remoteSize: null,
        localDirty: true,
        remoteDirty: false,
      });
    }

    // Push only these specific files
    const result = await this.syncEngine.executePush(
      session.machineId,
      connInfo,
      machine.openclawHome,
      'bot-config-agent',
      relativePaths,
    );

    // On successful sync, update session state
    if (result.status === 'completed') {
      for (const [, snap] of dirtyFiles) {
        snap.originalContent = snap.currentContent;
        snap.dirty = false;
      }
    }

    log.info(
      { agentId, syncedFiles: result.syncedFiles, failedFiles: result.failedFiles },
      'Config sync completed',
    );

    return {
      syncedFiles: result.syncedFiles,
      failedFiles: result.failedFiles,
      errors: result.errors.map((e) => `${e.relativePath}: ${e.error}`),
    };
  }

  /**
   * Resets (deletes) the active session for an agent, discarding unsaved changes.
   */
  resetSession(agentId: string): boolean {
    const session = this.findSessionByAgent(agentId);
    if (!session) return false;
    this.sessions.delete(session.id);
    closeBrowser(`bot-config-${session.id}`).catch(() => {});
    log.info({ sessionId: session.id, agentId }, 'Config chat session reset');
    return true;
  }

  /**
   * Returns session info for an agent (if one exists).
   */
  getSessionInfo(agentId: string): { sessionId: string; fileCount: number; dirtyCount: number; messageCount: number } | null {
    const session = this.findSessionByAgent(agentId);
    if (!session) return null;

    let dirtyCount = 0;
    for (const snap of session.files.values()) {
      if (snap.dirty) dirtyCount++;
    }

    return {
      sessionId: session.id,
      fileCount: session.files.size,
      dirtyCount,
      messageCount: session.messages.length,
    };
  }

  private findSessionByAgent(agentId: string): ConfigChatSession | undefined {
    for (const session of this.sessions.values()) {
      if (session.agentId === agentId && session.status === 'active') {
        return session;
      }
    }
    return undefined;
  }

  private scheduleCleanup(sessionId: string): void {
    setTimeout(() => {
      const session = this.sessions.get(sessionId);
      if (!session) return;
      const elapsed = Date.now() - session.lastActivityAt.getTime();
      if (elapsed >= SESSION_TTL_MS) {
        this.sessions.delete(sessionId);
        closeBrowser(`bot-config-${sessionId}`).catch(() => {});
        log.info({ sessionId }, 'Config chat session expired');
      } else {
        this.scheduleCleanup(sessionId);
      }
    }, SESSION_TTL_MS);
  }
}
