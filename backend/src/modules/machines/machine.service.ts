import type { MachineRepository } from './machine.repository.js';
import type {
  Machine,
  CreateMachineInput,
  UpdateMachineInput,
  MachineHealthCheck,
  MachineDiscovery,
  MachineStatus,
} from './machine.types.js';
import type { AgentRepository } from '../agents/agent.repository.js';
import type { SkillRepository } from '../skills/skill.repository.js';
import type { SSHPool, SSHConnectionInfo } from '../../transport/ssh-pool.js';
import type { SSHExecutor } from '../../transport/ssh-executor.js';
import type { TailscaleClient } from '../../transport/tailscale.js';
import { NotFoundError, ValidationError } from '../../shared/errors.js';
import { createChildLogger } from '../../shared/logger.js';
import { parseSkillFrontmatter } from '../../parsers/markdown-frontmatter.parser.js';

const log = createChildLogger('machine-service');

export class MachineService {
  constructor(
    private repo: MachineRepository,
    private sshPool: SSHPool,
    private sshExecutor: SSHExecutor,
    private tailscale: TailscaleClient,
    private agentRepo?: AgentRepository,
    private skillRepo?: SkillRepository,
  ) {}

  async listMachines(filters?: { status?: MachineStatus; tag?: string }): Promise<Machine[]> {
    return this.repo.findAll(filters);
  }

  async getMachine(id: string): Promise<Machine> {
    const machine = await this.repo.findById(id);
    if (!machine) throw new NotFoundError('Machine', id);
    return machine;
  }

  async createMachine(input: CreateMachineInput): Promise<Machine> {
    const existing = await this.repo.findByHostname(input.tailscaleHostname);
    if (existing) {
      throw new ValidationError(`Machine with hostname ${input.tailscaleHostname} already exists`);
    }
    return this.repo.create(input);
  }

  async updateMachine(id: string, input: UpdateMachineInput): Promise<Machine> {
    const machine = await this.repo.update(id, input);
    if (!machine) throw new NotFoundError('Machine', id);
    return machine;
  }

  async deleteMachine(id: string): Promise<void> {
    const deleted = await this.repo.delete(id);
    if (!deleted) throw new NotFoundError('Machine', id);
  }

  async healthCheck(id: string): Promise<MachineHealthCheck> {
    const machine = await this.getMachine(id);
    const connInfo = this.toConnectionInfo(machine);

    const tailscalePing = await this.tailscale.ping(machine.tailscaleHostname);
    let sshConnectivity = false;
    let openclawVersion: string | null = null;
    let gatewayStatus: 'active' | 'inactive' | 'unknown' = 'unknown';

    if (tailscalePing.reachable) {
      try {
        await this.sshPool.getConnection(connInfo);
        sshConnectivity = true;
        this.sshPool.releaseConnection(machine.id, (await this.sshPool.getConnection(connInfo)));
      } catch {
        sshConnectivity = false;
      }

      if (sshConnectivity) {
        openclawVersion = await this.sshExecutor.getOpenClawVersion(connInfo);
        gatewayStatus = await this.sshExecutor.getGatewayStatus(connInfo);
      }
    }

    const status: MachineStatus = sshConnectivity ? 'online' : tailscalePing.reachable ? 'online' : 'offline';

    await this.repo.updateStatus(id, status, {
      tailscaleIp: undefined,
      openclawVersion: openclawVersion ?? undefined,
    });

    const result: MachineHealthCheck = {
      status,
      tailscalePing,
      sshConnectivity,
      openclawVersion,
      gatewayStatus,
      checkedAt: new Date(),
    };

    log.info({ machineId: id, ...result }, 'Health check completed');
    return result;
  }

  async discoverStructure(id: string): Promise<MachineDiscovery> {
    const machine = await this.getMachine(id);
    const connInfo = this.toConnectionInfo(machine);
    const home = machine.openclawHome;

    // Use find instead of ls -d glob to avoid zsh "no matches found" failures
    const agentsOutput = await this.sshExecutor.exec(
      connInfo,
      `find ${home} -maxdepth 1 -type d \\( -name 'workspace' -o -name 'workspace-*' \\) 2>/dev/null | while read d; do basename "$d"; done`,
      { allowNonZero: true },
    );

    const agents = agentsOutput
      .split('\n')
      .filter(Boolean)
      .map((dir) => {
        const isDefault = dir === 'workspace';
        const agentId = isDefault ? 'main' : dir.replace('workspace-', '');
        return {
          agentId,
          workspacePath: dir,
          isDefault,
        };
      });

    const skillsOutput = await this.sshExecutor.exec(
      connInfo,
      `find ${home}/skills -maxdepth 1 -type d ! -name skills 2>/dev/null | while read d; do basename "$d"; done`,
      { allowNonZero: true },
    );
    const globalSkills = skillsOutput.split('\n').filter(Boolean);

    let cronJobCount = 0;
    try {
      const cronOutput = await this.sshExecutor.exec(
        connInfo,
        `cat ${home}/cron/jobs.json 2>/dev/null | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('jobs',[])))"`,
        { allowNonZero: true },
      );
      cronJobCount = parseInt(cronOutput.trim(), 10) || 0;
    } catch { /* no cron file */ }

    const countOutput = await this.sshExecutor.exec(
      connInfo,
      `find ${home} -type f ! -path '*/node_modules/*' ! -path '*/.git/*' ! -name '*.sqlite*' 2>/dev/null | wc -l`,
      { allowNonZero: true },
    );
    const fileCount = parseInt(countOutput.trim(), 10) || 0;

    if (this.agentRepo) {
      for (const agent of agents) {
        const persisted = await this.agentRepo.upsertFromDiscovery(
          id,
          agent.agentId,
          agent.isDefault,
          agent.workspacePath,
        );

        // Discover per-agent skills under {home}/{workspace}/skills/
        const agentSkillsOutput = await this.sshExecutor.exec(
          connInfo,
          `find ${home}/${agent.workspacePath}/skills -maxdepth 1 -type d ! -name skills 2>/dev/null | while read d; do basename "$d"; done`,
          { allowNonZero: true },
        );
        const agentSkills = agentSkillsOutput.split('\n').filter(Boolean);
        await this.agentRepo.updateDiscoveredSkills(persisted.id, agentSkills);

        // Upsert agent-scoped skills into the catalog (with SKILL.md content)
        if (this.skillRepo) {
          for (const skillKey of agentSkills) {
            await this.upsertSkillWithContent(
              connInfo, `${home}/${agent.workspacePath}/skills/${skillKey}`,
              skillKey, 'agent',
            );
          }
        }
      }
    }

    // Persist discovered global skills on the machine record
    await this.repo.updateDiscoveredSkills(id, globalSkills);

    // Upsert global skills into the catalog (with SKILL.md content)
    if (this.skillRepo) {
      for (const skillKey of globalSkills) {
        await this.upsertSkillWithContent(
          connInfo, `${home}/skills/${skillKey}`,
          skillKey, 'global',
        );
      }
    }

    log.info({ machineId: id, agents: agents.length, globalSkills: globalSkills.length, cronJobCount, fileCount }, 'Discovery completed');

    return { agents, globalSkills, cronJobCount, fileCount };
  }

  /**
   * List files in a remote skill directory, read all text files,
   * and upsert into the catalog with SKILL.md content + auxiliary files.
   * NOTE: paths must NOT be single-quoted so that ~ (tilde) expansion works.
   */
  private async upsertSkillWithContent(
    connInfo: SSHConnectionInfo,
    skillDir: string,
    skillKey: string,
    scope: 'global' | 'agent',
  ): Promise<void> {
    if (!this.skillRepo) return;

    // List all files in the skill directory (2 levels deep, max 50 files)
    // No quotes around skillDir so that ~ expands in the remote shell
    let fileNames: string[] = [];
    try {
      const listOutput = await this.sshExecutor.exec(
        connInfo,
        `find ${skillDir} -maxdepth 2 -type f 2>/dev/null | head -50 | while read f; do echo "\${f#${skillDir}/}"; done`,
        { allowNonZero: true, timeoutMs: 15_000 },
      );
      fileNames = listOutput.split('\n').filter(Boolean);
    } catch {
      log.warn({ skillKey, skillDir }, 'Could not list skill directory');
    }

    if (fileNames.length === 0) {
      log.warn({ skillKey, skillDir }, 'No files found in skill directory');
    }

    let skillMdContent: string | null = null;
    const auxiliaryFiles: Record<string, string> = {};

    for (const fileName of fileNames) {
      if (/\.(png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|zip|tar|gz|bin|exe|dll|so|dylib|sqlite|db)$/i.test(fileName)) {
        continue;
      }

      try {
        const content = await this.sshExecutor.exec(
          connInfo,
          `cat ${skillDir}/${fileName} 2>/dev/null`,
          { allowNonZero: true, timeoutMs: 10_000 },
        );
        if (content.length === 0) continue;

        if (fileName === 'SKILL.md') {
          skillMdContent = content;
        } else {
          auxiliaryFiles[fileName] = content;
        }
      } catch {
        log.debug({ skillKey, fileName }, 'Could not read skill file');
      }
    }

    let name = skillKey;
    let description: string | undefined;
    let requiresBins: string[] | undefined;
    let requiresEnv: string[] | undefined;

    if (skillMdContent) {
      const { frontmatter } = parseSkillFrontmatter(skillMdContent);
      if (frontmatter.name) name = frontmatter.name;
      if (frontmatter.description) description = frontmatter.description;
      requiresBins = frontmatter.metadata?.openclaw?.requires?.bins;
      requiresEnv = frontmatter.metadata?.openclaw?.requires?.env;
    }

    const hasAuxFiles = Object.keys(auxiliaryFiles).length > 0;

    const existing = await this.skillRepo.findByKey(skillKey);
    if (existing) {
      await this.skillRepo.update(existing.id, {
        skillMdContent: skillMdContent ?? undefined,
        name,
        description: description ?? existing.description ?? undefined,
        auxiliaryFiles: hasAuxFiles ? auxiliaryFiles : undefined,
        requiresBins,
        requiresEnv,
      });
    } else {
      await this.skillRepo.create({
        skillKey,
        name,
        description,
        scope,
        source: 'custom',
        skillMdContent: skillMdContent ?? undefined,
        auxiliaryFiles: hasAuxFiles ? auxiliaryFiles : undefined,
        requiresBins,
        requiresEnv,
      });
    }

    log.info(
      { skillKey, hasSkillMd: !!skillMdContent, auxFileCount: Object.keys(auxiliaryFiles).length },
      'Skill content synced',
    );
  }

  toConnectionInfo(machine: Machine): SSHConnectionInfo {
    return {
      machineId: machine.id,
      host: machine.tailscaleHostname,
      port: machine.sshPort,
      username: machine.sshUser,
      password: machine.sshPassword ?? undefined,
    };
  }
}
