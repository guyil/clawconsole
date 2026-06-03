import { createChildLogger } from '../../shared/logger.js';
import { AppError } from '../../shared/errors.js';
import type { SSHPool } from '../../transport/ssh-pool.js';
import type { FileTransfer } from '../../transport/file-transfer.js';
import type { MachineService } from '../machines/machine.service.js';
import type { MachineRepository } from '../machines/machine.repository.js';
import type { AgentRepository } from '../agents/agent.repository.js';
import type { AgentModelValue } from '../agents/agent.types.js';

const log = createChildLogger('model-config-service');

/** Shape of the relevant sections in openclaw.json */
interface OpenClawJsonAgents {
  defaults?: {
    model?: AgentModelValue;
    [k: string]: unknown;
  };
  list?: Array<{
    id: string;
    model?: AgentModelValue;
    [k: string]: unknown;
  }>;
  [k: string]: unknown;
}

interface OpenClawJson {
  agents?: OpenClawJsonAgents;
  [k: string]: unknown;
}

export interface RemoteModelInfo {
  globalDefault: AgentModelValue | null;
  agentOverrides: Array<{ agentId: string; model: AgentModelValue }>;
}

export class ModelConfigService {
  constructor(
    private readonly sshPool: SSHPool,
    private readonly fileTransfer: FileTransfer,
    private readonly machineService: MachineService,
    private readonly machineRepo: MachineRepository,
    private readonly agentRepo: AgentRepository,
  ) {}

  /** Read openclaw.json from the remote machine and extract model settings */
  async readRemoteConfig(machineId: string): Promise<RemoteModelInfo> {
    const machine = await this.machineRepo.findById(machineId);
    if (!machine) throw new AppError('Machine not found', 'NOT_FOUND', 404);

    const connInfo = this.machineService.toConnectionInfo(machine);
    const configPath = `${machine.openclawHome}/openclaw.json`;

    let content: string;
    try {
      content = await this.fileTransfer.downloadFile(connInfo, configPath);
    } catch {
      log.info({ machineId }, 'No openclaw.json found on remote machine');
      return { globalDefault: null, agentOverrides: [] };
    }

    let parsed: OpenClawJson;
    try {
      parsed = JSON.parse(content);
    } catch {
      log.warn({ machineId }, 'Failed to parse remote openclaw.json');
      return { globalDefault: null, agentOverrides: [] };
    }

    const globalDefault = parsed.agents?.defaults?.model ?? null;
    const agentOverrides: RemoteModelInfo['agentOverrides'] = [];

    if (parsed.agents?.list) {
      for (const entry of parsed.agents.list) {
        if (entry.model) {
          agentOverrides.push({ agentId: entry.id, model: entry.model });
        }
      }
    }

    return { globalDefault, agentOverrides };
  }

  /** Update the global default model in remote openclaw.json */
  async syncGlobalModel(machineId: string, model: AgentModelValue): Promise<void> {
    const machine = await this.machineRepo.findById(machineId);
    if (!machine) throw new AppError('Machine not found', 'NOT_FOUND', 404);

    const connInfo = this.machineService.toConnectionInfo(machine);
    const configPath = `${machine.openclawHome}/openclaw.json`;

    const parsed = await this.readOpenClawJson(connInfo, configPath);

    if (!parsed.agents) parsed.agents = {};
    if (!parsed.agents.defaults) parsed.agents.defaults = {};
    parsed.agents.defaults.model = model;

    await this.writeOpenClawJson(connInfo, configPath, parsed);
    await this.restartGateway(connInfo);

    await this.machineRepo.updateModelConfig(machineId, {
      model,
      lastSyncedAt: new Date().toISOString(),
    });

    log.info({ machineId, model }, 'Global model config synced to remote');
  }

  /** Update a specific agent's model override in remote openclaw.json */
  async syncAgentModel(machineId: string, agentId: string, dbRecordId: string, model: AgentModelValue): Promise<void> {
    const machine = await this.machineRepo.findById(machineId);
    if (!machine) throw new AppError('Machine not found', 'NOT_FOUND', 404);

    const connInfo = this.machineService.toConnectionInfo(machine);
    const configPath = `${machine.openclawHome}/openclaw.json`;

    const parsed = await this.readOpenClawJson(connInfo, configPath);

    if (!parsed.agents) parsed.agents = {};
    if (!parsed.agents.list) parsed.agents.list = [];

    const existingIdx = parsed.agents.list.findIndex((a) => a.id === agentId);
    if (existingIdx >= 0) {
      parsed.agents.list[existingIdx].model = model;
    } else {
      parsed.agents.list.push({ id: agentId, model });
    }

    await this.writeOpenClawJson(connInfo, configPath, parsed);
    await this.restartGateway(connInfo);

    await this.agentRepo.updateModelConfig(dbRecordId, {
      model,
      lastSyncedAt: new Date().toISOString(),
    });

    log.info({ machineId, agentId, model }, 'Agent model config synced to remote');
  }

  /** Remove a specific agent's model override from remote openclaw.json */
  async removeAgentModel(machineId: string, agentId: string, dbRecordId: string): Promise<void> {
    const machine = await this.machineRepo.findById(machineId);
    if (!machine) throw new AppError('Machine not found', 'NOT_FOUND', 404);

    const connInfo = this.machineService.toConnectionInfo(machine);
    const configPath = `${machine.openclawHome}/openclaw.json`;

    const parsed = await this.readOpenClawJson(connInfo, configPath);

    if (parsed.agents?.list) {
      const entry = parsed.agents.list.find((a) => a.id === agentId);
      if (entry) {
        delete entry.model;
        // Clean up empty entries
        parsed.agents.list = parsed.agents.list.filter(
          (a) => Object.keys(a).length > 1 || a.id !== agentId,
        );
      }
    }

    await this.writeOpenClawJson(connInfo, configPath, parsed);
    await this.restartGateway(connInfo);

    await this.agentRepo.updateModelConfig(dbRecordId, null);

    log.info({ machineId, agentId }, 'Agent model config removed from remote');
  }

  private async readOpenClawJson(
    connInfo: { machineId: string; host: string; port: number; username: string; password?: string },
    configPath: string,
  ): Promise<OpenClawJson> {
    try {
      const content = await this.fileTransfer.downloadFile(connInfo, configPath);
      return JSON.parse(content);
    } catch {
      return {};
    }
  }

  private async writeOpenClawJson(
    connInfo: { machineId: string; host: string; port: number; username: string; password?: string },
    configPath: string,
    data: OpenClawJson,
  ): Promise<void> {
    const content = JSON.stringify(data, null, 2);
    await this.fileTransfer.uploadFile(connInfo, configPath, content);
  }

  private async restartGateway(
    connInfo: { machineId: string; host: string; port: number; username: string; password?: string },
  ): Promise<void> {
    try {
      await this.sshPool.executeCommand(
        connInfo,
        'pkill -HUP -f openclaw-gateway 2>/dev/null || true',
        { timeoutMs: 10_000 },
      );
      log.info({ machineId: connInfo.machineId }, 'Gateway restart signal sent');
    } catch (err) {
      log.warn({ machineId: connInfo.machineId, err }, 'Failed to restart gateway');
    }
  }
}
