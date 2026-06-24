import type { MachineRepository } from './machine.repository.js';
import type {
  Machine,
  CreateMachineInput,
  UpdateMachineInput,
  MachineHealthCheck,
  MachineDiscovery,
  DiscoveredAgent,
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
import { config } from '../../config/index.js';

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

    // Public-IP / Docker machines have no Tailscale peer: report the gate as
    // reachable (sentinel, no latency) and probe SSH/gateway directly. The
    // resolveIp backfill below is skipped for these machines.
    const tailscalePing = machine.directConnect
      ? { reachable: true, latencyMs: null }
      : await this.tailscale.ping(machine.tailscaleHostname);
    let sshConnectivity = false;
    let openclawVersion: string | null = null;
    let gatewayStatus: 'active' | 'inactive' | 'unknown' = 'unknown';
    let resolvedIp: string | null = null;

    if (tailscalePing.reachable) {
      // directConnect machines: skip tailscale.resolveIp (no Tailscale peer),
      // go straight to the SSH probe against the raw IP + custom port.
      if (!machine.directConnect) {
        // Backfill the machines.tailscale_ip column the first time we
        // confirm the peer is reachable. Without this the UI shows a blank
        // IP forever even though the box is healthy. We do this lazily
        // (only when reachable) so a transient resolve failure doesn't
        // overwrite a previously-known-good IP.
        try {
          resolvedIp = await this.tailscale.resolveIp(machine.tailscaleHostname);
        } catch {
          resolvedIp = null;
        }
      }

      // Probe with a real, short command. Just opening the SSH handshake
      // is not enough: hosts where the shell or filesystem is wedged will
      // accept the connection but block on every subsequent exec, which
      // poisons the SSH pool for 60s per command.
      try {
        const probe = await this.sshPool.executeCommand(connInfo, 'echo ok', { timeoutMs: 5_000 });
        sshConnectivity = probe.stdout.trim() === 'ok';
      } catch {
        sshConnectivity = false;
      }

      if (sshConnectivity) {
        openclawVersion = await this.sshExecutor.getOpenClawVersion(connInfo);
        // For directConnect machines the gateway runs inside Docker (no
        // `systemctl --user`), so probe its HTTP /health endpoint instead.
        gatewayStatus = machine.directConnect
          ? await this.probeGatewayHttpHealth(machine)
          : await this.sshExecutor.getGatewayStatus(connInfo);
      }
    }

    // Only treat as online when we successfully ran a real command on the box.
    // Tailscale ping reachability alone is misleading: a wedged host will
    // ping fine but every SSH exec will hit the 60s timeout.
    const status: MachineStatus = sshConnectivity ? 'online' : 'offline';

    await this.repo.updateStatus(id, status, {
      tailscaleIp: resolvedIp ?? undefined,
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

  /**
   * Determine gateway health for a directConnect (Docker) machine by GETting
   * `http://{host}:{port}/health`. The openclaw gateway serves
   * `{"ok":true,"status":"live"}` with HTTP 200 there. 200 → 'active',
   * anything else (non-200 / unreachable / timeout) → 'inactive'.
   */
  private async probeGatewayHttpHealth(machine: Machine): Promise<'active' | 'inactive'> {
    const port = machine.gatewayPort ?? config.gateway.defaultPort;
    const url = `http://${machine.tailscaleHostname}:${port}/health`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    try {
      const res = await fetch(url, { signal: controller.signal });
      return res.status === 200 ? 'active' : 'inactive';
    } catch {
      return 'inactive';
    } finally {
      clearTimeout(timer);
    }
  }

  async discoverStructure(id: string): Promise<MachineDiscovery> {
    const machine = await this.getMachine(id);

    // Docker single-gateway-many-agents machines: agents live inside the
    // container, not under a host openclawHome, so SSH `find` won't see them.
    // Discover via the gateway RPC instead.
    if (machine.directConnect) {
      return this.discoverViaGateway(machine);
    }

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
      // Process all agents in parallel — each agent's SSH commands are independent.
      await Promise.allSettled(agents.map(async (agent) => {
        const persisted = await this.agentRepo!.upsertFromDiscovery(
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
        await this.agentRepo!.updateDiscoveredSkills(persisted.id, agentSkills);

        // Upsert agent-scoped skills into the catalog (with SKILL.md content)
        // Run in parallel — the SSH pool throttles concurrency automatically.
        if (this.skillRepo) {
          await Promise.allSettled(agentSkills.map((skillKey) =>
            this.upsertSkillWithContent(
              connInfo, `${home}/${agent.workspacePath}/skills/${skillKey}`,
              skillKey, 'agent',
            ),
          ));
        }
      }));
    }

    // Persist discovered global skills on the machine record
    await this.repo.updateDiscoveredSkills(id, globalSkills);

    // Upsert global skills into the catalog (with SKILL.md content) — parallel.
    if (this.skillRepo) {
      await Promise.allSettled(globalSkills.map((skillKey) =>
        this.upsertSkillWithContent(
          connInfo, `${home}/skills/${skillKey}`,
          skillKey, 'global',
        ),
      ));
    }

    log.info({ machineId: id, agents: agents.length, globalSkills: globalSkills.length, cronJobCount, fileCount }, 'Discovery completed');

    return { agents, globalSkills, cronJobCount, fileCount };
  }

  /**
   * Agent discovery for directConnect (Docker single-gateway-many-agents)
   * machines. The host has no per-agent workspace dirs to `find`, so we ask
   * the gateway over RPC (`agents.list`) for the list of hosted agents and
   * map each entry onto the `DiscoveredAgent` shape.
   *
   * Fails gracefully: if the gateway pool is unwired, the machine isn't
   * connected, or the RPC errors/returns nothing, we return an empty agent
   * list rather than throwing — discovery for these machines is best-effort.
   */
  /**
   * Discover agents on a directConnect (Docker single-gateway-many-agents)
   * machine via the gateway `admin-http-rpc` plugin
   * (`POST /api/v1/admin/rpc`, method `agents.list`).
   *
   * We deliberately use HTTP admin RPC rather than the WebSocket pool here: a
   * remote shared-token WebSocket client connects but is granted no operator
   * scopes (the gateway requires a paired device identity for that), so WS RPCs
   * fail with `missing scope`. The admin-http-rpc surface instead treats the
   * shared-secret bearer as full operator access, which is the supported path
   * for host tooling that holds the gateway operator token.
   *
   * Session monitoring (sessions.list / chat.history) is NOT exposed by the
   * admin-http-rpc allowlist, so it is unavailable for directConnect machines
   * until device pairing is implemented; agent/health/config discovery work.
   */
  private async discoverViaGateway(machine: Machine): Promise<MachineDiscovery> {
    const empty: MachineDiscovery = { agents: [], globalSkills: [], cronJobCount: 0, fileCount: 0 };

    if (!machine.gatewayToken) {
      log.warn(
        { machineId: machine.id },
        'directConnect machine has no gatewayToken; cannot discover agents via admin-http-rpc',
      );
      return empty;
    }

    const port = machine.gatewayPort ?? config.gateway.defaultPort;
    const url = `http://${machine.tailscaleHostname}:${port}/api/v1/admin/rpc`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    let raw: unknown;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${machine.gatewayToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ method: 'agents.list', params: {} }),
        signal: controller.signal,
      });
      if (!res.ok) {
        log.warn({ machineId: machine.id, status: res.status }, 'admin-http-rpc agents.list HTTP error');
        return empty;
      }
      const body = (await res.json()) as { ok?: boolean; payload?: unknown; error?: { message?: string } };
      if (!body.ok) {
        log.warn({ machineId: machine.id, err: body.error?.message }, 'admin-http-rpc agents.list returned error');
        return empty;
      }
      raw = body.payload;
    } catch (err) {
      log.warn({ machineId: machine.id, err: (err as Error).message }, 'admin-http-rpc agents.list request failed');
      return empty;
    } finally {
      clearTimeout(timer);
    }

    // openclaw returns an array of agent entries: { id, workspace, model, ... }
    // (or, defensively, { agents: [...] }).
    const entries: Array<Record<string, unknown>> = Array.isArray(raw)
      ? (raw as Array<Record<string, unknown>>)
      : Array.isArray((raw as { agents?: unknown })?.agents)
        ? ((raw as { agents: Array<Record<string, unknown>> }).agents)
        : [];

    const agents: DiscoveredAgent[] = entries.map((entry) => {
      const agentId = String(entry.id ?? entry.agentId ?? entry.name ?? '').trim();
      const isDefault = Boolean(entry.isDefault) || Boolean(entry.default) || agentId === 'main';
      // openclaw returns an absolute container workspace path
      // (e.g. /home/node/.openclaw/workspace-bot-01); clawconsole stores the
      // basename convention ('workspace' | 'workspace-<id>').
      const rawWs =
        typeof entry.workspace === 'string'
          ? entry.workspace
          : typeof entry.workspacePath === 'string'
            ? entry.workspacePath
            : undefined;
      const workspacePath =
        rawWs?.split('/').filter(Boolean).pop() ?? (isDefault ? 'workspace' : `workspace-${agentId}`);
      return { agentId, workspacePath, isDefault };
    }).filter((a) => a.agentId.length > 0);

    if (this.agentRepo) {
      await Promise.allSettled(agents.map((agent) =>
        this.agentRepo!.upsertFromDiscovery(
          machine.id,
          agent.agentId,
          agent.isDefault,
          agent.workspacePath,
        ),
      ));
    }

    log.info({ machineId: machine.id, agents: agents.length }, 'admin-http-rpc agent discovery completed');

    return { agents, globalSkills: [], cronJobCount: 0, fileCount: 0 };
  }

  /**
   * Read all text files from a remote skill directory and upsert into the catalog.
   *
   * Uses a single SSH round-trip instead of one per file:
   *   1. `eval echo` expands any leading tilde so `find` returns absolute paths.
   *   2. A shell pipeline lists non-binary files and base64-encodes each one.
   *   3. The output is parsed on the Node side to extract SKILL.md + aux files.
   *
   * This collapses N+1 sequential SSH commands into 1, avoiding request timeouts
   * when a machine has many skills. It also fixes the tilde-in-prefix bug where
   * `${f#~/.openclaw/...}` never matched against the absolute path returned by find.
   */
  private async upsertSkillWithContent(
    connInfo: SSHConnectionInfo,
    skillDir: string,
    skillKey: string,
    scope: 'global' | 'agent',
  ): Promise<void> {
    if (!this.skillRepo) return;

    // Sentinel that cannot appear inside base64 output.
    const SEP = '===CLAWSKILL===';

    // Build the command using plain string concatenation so that shell variable
    // references like ${f#$exp/} are NOT accidentally interpolated by TypeScript.
    const cmd =
      'exp=$(eval echo ' + skillDir + ' 2>/dev/null || echo ' + skillDir + '); ' +
      'find "$exp" -maxdepth 2 -type f 2>/dev/null ' +
      '| grep -viE "\\.(png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|zip|tar|gz|bin|exe|dll|so|dylib|sqlite|db)$" ' +
      '| head -50 ' +
      '| while read f; do ' +
      'printf "' + SEP + '%s\\n" "${f#$exp/}"; ' +
      'base64 < "$f" 2>/dev/null; ' +
      'printf "\\n"; ' +
      'done';

    let output = '';
    try {
      output = await this.sshExecutor.exec(connInfo, cmd, { allowNonZero: true, timeoutMs: 20_000 });
    } catch {
      log.warn({ skillKey, skillDir }, 'Could not read skill files');
      return;
    }

    // Parse: lines starting with SEP introduce a new file (relative name follows).
    // All subsequent lines until the next SEP are base64-encoded file content.
    let skillMdContent: string | null = null;
    const auxiliaryFiles: Record<string, string> = {};
    let currentName: string | null = null;
    let currentB64 = '';

    const flush = () => {
      if (!currentName || !currentB64.trim()) return;
      try {
        const decoded = Buffer.from(currentB64.replace(/\s+/g, ''), 'base64').toString('utf8');
        if (decoded.length > 0) {
          if (currentName === 'SKILL.md') {
            skillMdContent = decoded;
          } else {
            auxiliaryFiles[currentName] = decoded;
          }
        }
      } catch { /* skip malformed base64 */ }
    };

    for (const line of output.split('\n')) {
      if (line.startsWith(SEP)) {
        flush();
        currentName = line.slice(SEP.length).trim();
        currentB64 = '';
      } else if (currentName) {
        currentB64 += line + '\n';
      }
    }
    flush();

    if (!skillMdContent && Object.keys(auxiliaryFiles).length === 0) {
      log.warn({ skillKey, skillDir }, 'No files found in skill directory');
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
