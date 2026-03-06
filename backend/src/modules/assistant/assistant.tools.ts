import type { LangGraphToolDef } from '../../shared/langgraph/types.js';
import type { MachineService } from '../machines/machine.service.js';
import type { MachineRepository } from '../machines/machine.repository.js';
import type { AgentRepository } from '../agents/agent.repository.js';
import type { SyncRepository } from '../sync/sync.repository.js';
import type { SSHPool } from '../../transport/ssh-pool.js';
import { createChildLogger } from '../../shared/logger.js';

const log = createChildLogger('assistant-tools');

export interface AssistantToolDeps {
  machineService: MachineService;
  machineRepo: MachineRepository;
  agentRepo: AgentRepository;
  syncRepo: SyncRepository;
  sshPool: SSHPool;
}

/**
 * Builds the full set of tools available to the AI assistant.
 * These tools give the agent visibility into ClawConsole state
 * and the ability to execute SSH commands on managed machines.
 */
export function buildAssistantTools(deps: AssistantToolDeps): LangGraphToolDef[] {
  return [
    createListMachinesTool(deps),
    createGetMachineInfoTool(deps),
    createSshExecuteTool(deps),
    createListAgentsTool(deps),
    createGetAgentInfoTool(deps),
    createHealthCheckTool(deps),
    createGetSyncHistoryTool(deps),
    createWebFetchTool(),
  ];
}

function createListMachinesTool(deps: AssistantToolDeps): LangGraphToolDef {
  return {
    name: 'list_machines',
    description: 'List all managed machines in the ClawConsole cluster with their current status, hostname, and agent count. Use this first to discover available machines before operating on them.',
    schema: {},
    handler: async () => {
      try {
        const machines = await deps.machineService.listMachines();
        if (machines.length === 0) return 'No machines registered in ClawConsole.';

        const rows = machines.map((m) => ({
          id: m.id,
          name: m.name,
          hostname: m.tailscaleHostname,
          ip: m.tailscaleIp,
          status: m.status,
          openclawVersion: m.openclawVersion,
          agentCount: m.agentCount,
          os: m.osInfo,
        }));
        return JSON.stringify(rows, null, 2);
      } catch (err) {
        return `Error listing machines: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  };
}

function createGetMachineInfoTool(deps: AssistantToolDeps): LangGraphToolDef {
  return {
    name: 'get_machine_info',
    description: 'Get detailed information about a specific machine including SSH config, OpenClaw version, discovered skills, and last health check time.',
    schema: {
      machineId: { type: 'string', description: 'The machine ID (UUID) to query' },
    },
    handler: async (args) => {
      try {
        const machine = await deps.machineService.getMachine(args.machineId as string);
        return JSON.stringify({
          id: machine.id,
          name: machine.name,
          hostname: machine.tailscaleHostname,
          ip: machine.tailscaleIp,
          status: machine.status,
          sshUser: machine.sshUser,
          sshPort: machine.sshPort,
          openclawHome: machine.openclawHome,
          openclawVersion: machine.openclawVersion,
          os: machine.osInfo,
          agentCount: machine.agentCount,
          discoveredSkills: machine.discoveredSkills,
          lastHealthCheck: machine.lastHealthCheckAt?.toISOString(),
          tags: machine.tags,
        }, null, 2);
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  };
}

function createSshExecuteTool(deps: AssistantToolDeps): LangGraphToolDef {
  return {
    name: 'ssh_execute',
    description: 'Execute a shell command on a remote machine via SSH. Returns stdout, stderr, and exit code. Use this for system administration tasks like installing packages, checking services, reading files, etc.',
    schema: {
      machineId: { type: 'string', description: 'The machine ID (UUID) to execute the command on' },
      command: { type: 'string', description: 'The shell command to execute on the remote machine' },
      timeoutSeconds: { type: 'number', description: 'Command timeout in seconds (default: 30, max: 300)' },
    },
    handler: async (args) => {
      const machineId = args.machineId as string;
      const command = args.command as string;
      const timeout = Math.min(Number(args.timeoutSeconds) || 30, 300);

      try {
        const machine = await deps.machineRepo.findById(machineId);
        if (!machine) return `Error: Machine ${machineId} not found`;

        const connInfo = deps.machineService.toConnectionInfo(machine);
        log.info({ machineId, command }, 'AI assistant executing SSH command');

        const result = await deps.sshPool.executeCommand(connInfo, command, {
          timeoutMs: timeout * 1000,
        });

        return JSON.stringify({
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
        });
      } catch (err) {
        return `Error executing command: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  };
}

function createListAgentsTool(deps: AssistantToolDeps): LangGraphToolDef {
  return {
    name: 'list_agents',
    description: 'List agents (AI bots) registered in ClawConsole. Can filter by machine ID to see agents on a specific machine.',
    schema: {
      machineId: { type: 'string', description: 'Optional machine ID to filter agents by machine. If omitted, lists all agents.' },
    },
    handler: async (args) => {
      try {
        const machineId = args.machineId as string | undefined;
        if (machineId) {
          const agents = await deps.agentRepo.findByMachineId(machineId);
          if (agents.length === 0) return `No agents found on machine ${machineId}`;
          return JSON.stringify(agents.map((a) => ({
            id: a.id,
            agentId: a.agentId,
            name: a.name,
            status: a.status,
            isDefault: a.isDefault,
            workspacePath: a.workspacePath,
            discoveredSkills: a.discoveredSkills,
          })), null, 2);
        }

        const agents = await deps.agentRepo.findAll();
        if (agents.length === 0) return 'No agents registered in ClawConsole.';
        return JSON.stringify(agents.map((a) => ({
          id: a.id,
          agentId: a.agentId,
          name: a.name,
          machineName: a.machineName,
          machineHostname: a.machineHostname,
          machineStatus: a.machineStatus,
          status: a.status,
          isDefault: a.isDefault,
        })), null, 2);
      } catch (err) {
        return `Error listing agents: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  };
}

function createGetAgentInfoTool(deps: AssistantToolDeps): LangGraphToolDef {
  return {
    name: 'get_agent_info',
    description: 'Get detailed information about a specific agent including its workspace path, status, and discovered skills.',
    schema: {
      agentId: { type: 'string', description: 'The agent ID (UUID, not the agent_id string) to query' },
    },
    handler: async (args) => {
      try {
        const agent = await deps.agentRepo.findById(args.agentId as string);
        if (!agent) return `Agent not found: ${args.agentId}`;

        return JSON.stringify({
          id: agent.id,
          agentId: agent.agentId,
          machineId: agent.machineId,
          name: agent.name,
          description: agent.description,
          isDefault: agent.isDefault,
          workspacePath: agent.workspacePath,
          discoveredSkills: agent.discoveredSkills,
          status: agent.status,
          lastSyncedAt: agent.lastSyncedAt?.toISOString(),
        }, null, 2);
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  };
}

function createHealthCheckTool(deps: AssistantToolDeps): LangGraphToolDef {
  return {
    name: 'health_check',
    description: 'Run a comprehensive health check on a machine. Checks Tailscale connectivity, SSH access, OpenClaw version, and gateway status.',
    schema: {
      machineId: { type: 'string', description: 'The machine ID (UUID) to health-check' },
    },
    handler: async (args) => {
      try {
        const result = await deps.machineService.healthCheck(args.machineId as string);
        return JSON.stringify({
          status: result.status,
          tailscalePing: result.tailscalePing,
          sshConnectivity: result.sshConnectivity,
          openclawVersion: result.openclawVersion,
          gatewayStatus: result.gatewayStatus,
          checkedAt: result.checkedAt.toISOString(),
        }, null, 2);
      } catch (err) {
        return `Error running health check: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  };
}

function createGetSyncHistoryTool(deps: AssistantToolDeps): LangGraphToolDef {
  return {
    name: 'get_sync_history',
    description: 'Get recent file synchronization operations for a machine. Shows sync type, direction, status, and file counts.',
    schema: {
      machineId: { type: 'string', description: 'The machine ID (UUID) to query sync history for' },
      limit: { type: 'number', description: 'Maximum number of results (default: 10)' },
    },
    handler: async (args) => {
      try {
        const machineId = args.machineId as string;
        const limit = Number(args.limit) || 10;
        const operations = await deps.syncRepo.findOperationsByMachine(machineId, limit);

        if (operations.length === 0) return `No sync operations found for machine ${machineId}`;
        return JSON.stringify(operations, null, 2);
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  };
}

function createWebFetchTool(): LangGraphToolDef {
  return {
    name: 'web_fetch',
    description: 'Fetch the content of a URL and return it as text. Useful for downloading scripts, checking endpoints, or fetching documentation.',
    schema: {
      url: { type: 'string', description: 'The URL to fetch (e.g. "https://example.com/install.sh")' },
    },
    handler: async (args) => {
      let url = (args.url as string)?.trim();
      if (!url) return 'Error: url parameter is required';

      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = `https://${url}`;
      }

      try {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(15_000),
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; ClawConsole-Assistant/1.0)',
            Accept: 'text/html,text/plain,application/json,*/*',
          },
          redirect: 'follow',
        });

        if (!response.ok) {
          return `HTTP ${response.status}: ${response.statusText}`;
        }
        const text = await response.text();
        return text.slice(0, 10_000);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('abort') || msg.includes('timeout')) {
          return `Error: Request to ${url} timed out.`;
        }
        return `Error fetching ${url}: ${msg}`;
      }
    },
  };
}
