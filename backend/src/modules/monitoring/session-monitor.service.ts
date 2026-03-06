import type { SSHPool, SSHConnectionInfo } from '../../transport/ssh-pool.js';
import type { MonitoringRepository } from './monitoring.repository.js';
import type { GatewayConnectorPool } from './gateway-connector.js';
import type { UpsertSessionSnapshotInput, InsertSessionMessageInput, MessageRole } from './monitoring.types.js';
import { createChildLogger } from '../../shared/logger.js';

const log = createChildLogger('session-monitor');

interface SessionListRow {
  key: string;
  sessionId?: string;
  channel?: string;
  chatType?: string;
  origin?: {
    from?: string;
    to?: string;
    provider?: string;
    surface?: string;
  };
  model?: string;
  modelProvider?: string;
  thinkingLevel?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cacheRead?: number;
  cacheWrite?: number;
  label?: string;
  displayName?: string;
  sendPolicy?: string;
  compactionCount?: number;
  updatedAt?: number;
}

interface SessionsListResult {
  sessions: SessionListRow[];
  agents?: Array<{ id: string }>;
}

interface TranscriptMessage {
  role?: string;
  content?: string | Array<{ type: string; text?: string }>;
  provider?: string;
  model?: string;
  api?: string;
  stopReason?: string;
  usage?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    totalTokens?: number;
    cost?: { total?: number };
  };
  timestamp?: number;
}

export class SessionMonitorService {
  constructor(
    private repo: MonitoringRepository,
    private gatewayPool: GatewayConnectorPool,
    private sshPool: SSHPool,
  ) {}

  /**
   * Sync session metadata from a machine's gateway via RPC.
   */
  async syncSessionsViaGateway(machineId: string): Promise<number> {
    if (!this.gatewayPool.isConnected(machineId)) {
      log.debug({ machineId }, 'Gateway not connected, skipping session sync');
      return 0;
    }

    try {
      const result = await this.gatewayPool.request<SessionsListResult>(
        machineId,
        'sessions.list',
        { allAgents: true, limit: 500 },
      );

      if (!result?.sessions?.length) return 0;

      const inputs: UpsertSessionSnapshotInput[] = result.sessions.map((s) => {
        // Extract agentId from session key (format: agent:<agentId>:...)
        const agentId = extractAgentIdFromKey(s.key);
        return {
          machineId,
          agentId,
          sessionKey: s.key,
          sessionId: s.sessionId,
          channel: s.channel,
          chatType: s.chatType,
          originFrom: s.origin?.from,
          originTo: s.origin?.to,
          originProvider: s.origin?.provider,
          originSurface: s.origin?.surface,
          modelProvider: s.modelProvider,
          model: s.model,
          thinkingLevel: s.thinkingLevel,
          inputTokens: s.inputTokens ?? 0,
          outputTokens: s.outputTokens ?? 0,
          totalTokens: s.totalTokens ?? 0,
          cacheRead: s.cacheRead ?? 0,
          cacheWrite: s.cacheWrite ?? 0,
          label: s.label,
          displayName: s.displayName,
          sendPolicy: s.sendPolicy,
          compactionCount: s.compactionCount ?? 0,
          lastActivityAt: s.updatedAt
            ? new Date(s.updatedAt).toISOString()
            : null,
        };
      });

      await this.repo.upsertSessionSnapshots(inputs);
      log.info({ machineId, count: inputs.length }, 'Synced sessions via gateway');
      return inputs.length;
    } catch (err) {
      log.error({ machineId, err: (err as Error).message }, 'Failed to sync sessions via gateway');
      return 0;
    }
  }

  /**
   * Sync session metadata from a machine via SSH (fallback when gateway is unavailable).
   */
  async syncSessionsViaSSH(machineId: string, connInfo: SSHConnectionInfo, openclawHome: string): Promise<number> {
    try {
      // Expand ~ to $HOME for safe use inside double-quoted SSH commands
      const home = openclawHome.startsWith('~/')
        ? openclawHome.replace('~', '$HOME')
        : openclawHome;

      // OpenClaw session stores live at: <stateDir>/agents/<agentId>/sessions/sessions.json
      // Agent IDs come from workspace dirs: workspace (=main), workspace-<id>
      const { stdout: wsDirs } = await this.sshPool.executeCommand(
        connInfo,
        `find ${openclawHome} -maxdepth 1 -type d \\( -name 'workspace' -o -name 'workspace-*' \\) 2>/dev/null`,
        { timeoutMs: 10_000 },
      );

      const workspacePaths = wsDirs.split('\n').filter(Boolean);
      if (workspacePaths.length === 0) return 0;

      let totalSynced = 0;

      for (const wsPath of workspacePaths) {
        const dirName = wsPath.split('/').pop() ?? '';
        const agentId = dirName === 'workspace' ? 'main' : dirName.replace('workspace-', '');
        const storePath = `${home}/agents/${agentId}/sessions/sessions.json`;

        try {
          const { stdout: content } = await this.sshPool.executeCommand(
            connInfo,
            `cat "${storePath}" 2>/dev/null || echo ""`,
            { timeoutMs: 15_000 },
          );

          if (!content.trim()) continue;

          const store = JSON.parse(content) as Record<string, Record<string, unknown>>;
          const inputs: UpsertSessionSnapshotInput[] = [];

          for (const [sessionKey, entry] of Object.entries(store)) {
            const origin = entry.origin as Record<string, string> | undefined;
            inputs.push({
              machineId,
              agentId,
              sessionKey,
              sessionId: entry.sessionId as string,
              channel: entry.channel as string,
              chatType: entry.chatType as string,
              originFrom: origin?.from,
              originTo: origin?.to,
              originProvider: origin?.provider,
              originSurface: origin?.surface,
              modelProvider: entry.modelProvider as string,
              model: entry.model as string,
              thinkingLevel: entry.thinkingLevel as string,
              inputTokens: (entry.inputTokens as number) ?? 0,
              outputTokens: (entry.outputTokens as number) ?? 0,
              totalTokens: (entry.totalTokens as number) ?? 0,
              cacheRead: (entry.cacheRead as number) ?? 0,
              cacheWrite: (entry.cacheWrite as number) ?? 0,
              label: entry.label as string,
              displayName: entry.displayName as string,
              sendPolicy: entry.sendPolicy as string,
              compactionCount: (entry.compactionCount as number) ?? 0,
              lastActivityAt: entry.updatedAt
                ? new Date(entry.updatedAt as number).toISOString()
                : null,
            });
          }

          if (inputs.length > 0) {
            await this.repo.upsertSessionSnapshots(inputs);
            totalSynced += inputs.length;
          }
        } catch (err) {
          log.warn({ machineId, agentId, err: (err as Error).message }, 'Failed to parse session store');
        }
      }

      log.info({ machineId, count: totalSynced }, 'Synced sessions via SSH');
      return totalSynced;
    } catch (err) {
      log.error({ machineId, err: (err as Error).message }, 'Failed to sync sessions via SSH');
      return 0;
    }
  }

  /**
   * Pull transcript messages for a specific session from the gateway.
   */
  async pullTranscriptViaGateway(machineId: string, sessionKey: string, agentId: string): Promise<number> {
    if (!this.gatewayPool.isConnected(machineId)) {
      return 0;
    }

    try {
      const snapshot = await this.repo.findSessionSnapshotByKey(machineId, sessionKey);
      // Use sessionId from snapshot, falling back to sessionKey itself
      const sessionId = snapshot?.sessionId ?? sessionKey;

      const result = await this.gatewayPool.request<{ messages?: TranscriptMessage[] }>(
        machineId,
        'chat.history',
        { key: sessionKey },
      );

      if (!result?.messages?.length) return 0;

      const existingMaxIdx = await this.repo.getMaxMessageIndex(machineId, sessionId);

      const newMessages: InsertSessionMessageInput[] = [];
      for (let i = 0; i < result.messages.length; i++) {
        if (i <= existingMaxIdx) continue;

        const msg = result.messages[i];
        const content = extractTextContent(msg.content);
        const role = normalizeRole(msg.role);

        newMessages.push({
          machineId,
          agentId,
          sessionId,
          messageIndex: i,
          role,
          content,
          provider: msg.provider,
          model: msg.model,
          api: msg.api,
          stopReason: msg.stopReason,
          inputTokens: msg.usage?.input,
          outputTokens: msg.usage?.output,
          cacheReadTokens: msg.usage?.cacheRead,
          cacheWriteTokens: msg.usage?.cacheWrite,
          totalTokens: msg.usage?.totalTokens,
          costUsd: msg.usage?.cost?.total,
          messageTimestamp: msg.timestamp,
        });
      }

      if (newMessages.length > 0) {
        await this.repo.insertSessionMessages(newMessages);
      }

      log.info({ machineId, sessionKey, newCount: newMessages.length }, 'Pulled transcript via gateway');
      return newMessages.length;
    } catch (err) {
      log.error({ machineId, sessionKey, err: (err as Error).message }, 'Failed to pull transcript');
      return 0;
    }
  }

  /**
   * Pull transcript messages for a session via SSH.
   * Searches across agent directories if the primary path doesn't yield results.
   */
  async pullTranscriptViaSSH(
    machineId: string,
    connInfo: SSHConnectionInfo,
    openclawHome: string,
    agentId: string,
    sessionId: string,
    sessionFile?: string,
  ): Promise<number> {
    try {
      const home = openclawHome.startsWith('~/')
        ? openclawHome.replace('~', '$HOME')
        : openclawHome;
      const filename = sessionFile ?? `${sessionId}.jsonl`;

      // Try primary path first, then search across all agent directories
      let content = '';
      let resolvedAgentId = agentId;

      const primaryPath = `${home}/agents/${agentId}/sessions/${filename}`;
      const { stdout: primaryContent } = await this.sshPool.executeCommand(
        connInfo,
        `cat "${primaryPath}" 2>/dev/null || true`,
        { timeoutMs: 30_000 },
      );

      if (primaryContent.trim()) {
        content = primaryContent;
      } else {
        // Fallback: search for the session file across all agent directories
        const { stdout: foundPath } = await this.sshPool.executeCommand(
          connInfo,
          `find ${home}/agents -maxdepth 3 -name "${filename}" -type f 2>/dev/null | head -1`,
          { timeoutMs: 15_000 },
        );

        if (foundPath.trim()) {
          // Extract the actual agentId from the found path
          const pathMatch = foundPath.trim().match(/\/agents\/([^/]+)\/sessions\//);
          if (pathMatch) {
            resolvedAgentId = pathMatch[1];
          }

          const { stdout: fallbackContent } = await this.sshPool.executeCommand(
            connInfo,
            `cat "${foundPath.trim()}" 2>/dev/null || true`,
            { timeoutMs: 30_000 },
          );
          content = fallbackContent;
          log.info(
            { machineId, agentId, resolvedAgentId, sessionId },
            'Found transcript in different agent directory',
          );
        }
      }

      if (!content.trim()) return 0;

      const existingMaxIdx = await this.repo.getMaxMessageIndex(machineId, sessionId);

      const lines = content.split('\n').filter(Boolean);
      const newMessages: InsertSessionMessageInput[] = [];
      let messageIdx = 0;

      for (const line of lines) {
        try {
          const parsed = JSON.parse(line) as Record<string, unknown>;
          if (!parsed.message) continue;

          const msg = parsed.message as TranscriptMessage;

          if (messageIdx <= existingMaxIdx) {
            messageIdx++;
            continue;
          }

          const textContent = extractTextContent(msg.content);
          const role = normalizeRole(msg.role);

          newMessages.push({
            machineId,
            agentId: resolvedAgentId,
            sessionId,
            messageIndex: messageIdx,
            role,
            content: textContent,
            provider: msg.provider,
            model: msg.model,
            api: msg.api,
            stopReason: msg.stopReason,
            inputTokens: msg.usage?.input,
            outputTokens: msg.usage?.output,
            cacheReadTokens: msg.usage?.cacheRead,
            cacheWriteTokens: msg.usage?.cacheWrite,
            totalTokens: msg.usage?.totalTokens,
            costUsd: msg.usage?.cost?.total,
            messageTimestamp: msg.timestamp,
          });

          messageIdx++;
        } catch {
          messageIdx++;
        }
      }

      if (newMessages.length > 0) {
        await this.repo.insertSessionMessages(newMessages);
      }

      log.info({ machineId, agentId: resolvedAgentId, sessionId, newCount: newMessages.length }, 'Pulled transcript via SSH');
      return newMessages.length;
    } catch (err) {
      log.error({ machineId, agentId, sessionId, err: (err as Error).message }, 'Failed to pull transcript via SSH');
      return 0;
    }
  }
}

function extractAgentIdFromKey(sessionKey: string): string {
  // Standard format: agent:<agentId>:<channel>:direct:<peerId>
  //                   agent:<agentId>:main
  //                   cron:<jobId>
  // Legacy/channel format: <channel>:<peerId> (e.g. feishu:ou_xxx, telegram:12345)
  const parts = sessionKey.split(':');
  if (parts[0] === 'agent' && parts.length >= 2) {
    return parts[1];
  }
  // For non-agent-prefixed keys (legacy channel format), the session
  // belongs to the default 'main' agent, not the channel name.
  if (parts[0] === 'cron') {
    return parts[0];
  }
  return 'main';
}

function extractTextContent(content: unknown): string | null {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const textParts = content
      .filter((c: Record<string, unknown>) => c.type === 'text' && c.text)
      .map((c: Record<string, unknown>) => c.text as string);
    return textParts.length > 0 ? textParts.join('\n') : null;
  }
  return null;
}

function normalizeRole(role: string | undefined): MessageRole {
  switch (role) {
    case 'user':
    case 'assistant':
    case 'system':
    case 'tool':
      return role;
    default:
      return 'other';
  }
}
