import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildAssistantTools, type AssistantToolDeps } from '../../../src/modules/assistant/assistant.tools.js';

function createMockDeps(): AssistantToolDeps {
  return {
    machineService: {
      listMachines: vi.fn().mockResolvedValue([
        {
          id: 'm1',
          name: 'Beijing',
          tailscaleHostname: 'beijing.tailnet',
          tailscaleIp: '100.64.0.1',
          status: 'online',
          openclawVersion: '2026.3.1',
          agentCount: 2,
          osInfo: 'Ubuntu 22.04',
        },
        {
          id: 'm2',
          name: 'Shanghai',
          tailscaleHostname: 'shanghai.tailnet',
          tailscaleIp: '100.64.0.2',
          status: 'offline',
          openclawVersion: '2026.3.1',
          agentCount: 1,
          osInfo: 'Debian 12',
        },
      ]),
      getMachine: vi.fn().mockImplementation(async (id: string) => {
        if (id === 'm1') {
          return {
            id: 'm1',
            name: 'Beijing',
            tailscaleHostname: 'beijing.tailnet',
            tailscaleIp: '100.64.0.1',
            sshUser: 'claw',
            sshPort: 22,
            openclawHome: '~/.openclaw',
            openclawVersion: '2026.3.1',
            status: 'online',
            agentCount: 2,
            osInfo: 'Ubuntu 22.04',
            discoveredSkills: ['code-review', 'devops'],
            lastHealthCheckAt: new Date(),
            tags: ['production'],
          };
        }
        throw new Error(`Machine ${id} not found`);
      }),
      healthCheck: vi.fn().mockResolvedValue({
        status: 'online',
        tailscalePing: { reachable: true, latencyMs: 15 },
        sshConnectivity: true,
        openclawVersion: '2026.3.1',
        gatewayStatus: 'active',
        checkedAt: new Date(),
      }),
      toConnectionInfo: vi.fn().mockReturnValue({
        machineId: 'm1',
        host: 'beijing.tailnet',
        port: 22,
        username: 'claw',
      }),
    } as unknown as AssistantToolDeps['machineService'],

    machineRepo: {
      findById: vi.fn().mockImplementation(async (id: string) => {
        if (id === 'm1') {
          return {
            id: 'm1',
            name: 'Beijing',
            tailscaleHostname: 'beijing.tailnet',
            sshUser: 'claw',
            sshPort: 22,
          };
        }
        return null;
      }),
    } as unknown as AssistantToolDeps['machineRepo'],

    agentRepo: {
      findAll: vi.fn().mockResolvedValue([
        {
          id: 'a1',
          agentId: 'pm',
          name: 'PM Bot',
          machineName: 'Beijing',
          machineHostname: 'beijing.tailnet',
          machineStatus: 'online',
          status: 'active',
          isDefault: true,
        },
      ]),
      findByMachineId: vi.fn().mockResolvedValue([
        {
          id: 'a1',
          agentId: 'pm',
          name: 'PM Bot',
          status: 'active',
          isDefault: true,
          workspacePath: 'workspace',
          discoveredSkills: ['code-review'],
        },
      ]),
      findById: vi.fn().mockImplementation(async (id: string) => {
        if (id === 'a1') {
          return {
            id: 'a1',
            agentId: 'pm',
            machineId: 'm1',
            name: 'PM Bot',
            description: 'Project manager bot',
            isDefault: true,
            workspacePath: 'workspace',
            discoveredSkills: ['code-review'],
            status: 'active',
            lastSyncedAt: new Date(),
          };
        }
        return null;
      }),
    } as unknown as AssistantToolDeps['agentRepo'],

    syncRepo: {
      findOperationsByMachine: vi.fn().mockResolvedValue([
        {
          id: 'op1',
          machineId: 'm1',
          syncType: 'hot',
          direction: 'push',
          status: 'completed',
          syncedFiles: 2,
          failedFiles: 0,
        },
      ]),
    } as unknown as AssistantToolDeps['syncRepo'],

    sshPool: {
      executeCommand: vi.fn().mockResolvedValue({
        stdout: 'command output\n',
        stderr: '',
        exitCode: 0,
      }),
    } as unknown as AssistantToolDeps['sshPool'],
  };
}

describe('buildAssistantTools', () => {
  let deps: AssistantToolDeps;

  beforeEach(() => {
    deps = createMockDeps();
  });

  it('returns eight tools', () => {
    const tools = buildAssistantTools(deps);
    expect(tools).toHaveLength(8);
    const names = tools.map((t) => t.name);
    expect(names).toContain('list_machines');
    expect(names).toContain('get_machine_info');
    expect(names).toContain('ssh_execute');
    expect(names).toContain('list_agents');
    expect(names).toContain('get_agent_info');
    expect(names).toContain('health_check');
    expect(names).toContain('get_sync_history');
    expect(names).toContain('web_fetch');
  });

  describe('list_machines', () => {
    it('returns machine list as JSON', async () => {
      const tools = buildAssistantTools(deps);
      const tool = tools.find((t) => t.name === 'list_machines')!;
      const result = await tool.handler({});
      const parsed = JSON.parse(result);
      expect(parsed).toHaveLength(2);
      expect(parsed[0].name).toBe('Beijing');
      expect(parsed[0].status).toBe('online');
      expect(parsed[1].name).toBe('Shanghai');
      expect(parsed[1].status).toBe('offline');
    });

    it('returns message when no machines exist', async () => {
      (deps.machineService.listMachines as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      const tools = buildAssistantTools(deps);
      const tool = tools.find((t) => t.name === 'list_machines')!;
      const result = await tool.handler({});
      expect(result).toContain('No machines');
    });
  });

  describe('get_machine_info', () => {
    it('returns detailed machine info', async () => {
      const tools = buildAssistantTools(deps);
      const tool = tools.find((t) => t.name === 'get_machine_info')!;
      const result = await tool.handler({ machineId: 'm1' });
      const parsed = JSON.parse(result);
      expect(parsed.name).toBe('Beijing');
      expect(parsed.hostname).toBe('beijing.tailnet');
      expect(parsed.discoveredSkills).toContain('code-review');
    });

    it('returns error for non-existent machine', async () => {
      const tools = buildAssistantTools(deps);
      const tool = tools.find((t) => t.name === 'get_machine_info')!;
      const result = await tool.handler({ machineId: 'nonexistent' });
      expect(result).toContain('Error');
    });
  });

  describe('ssh_execute', () => {
    it('executes command and returns result', async () => {
      const tools = buildAssistantTools(deps);
      const tool = tools.find((t) => t.name === 'ssh_execute')!;
      const result = await tool.handler({ machineId: 'm1', command: 'uname -a' });
      const parsed = JSON.parse(result);
      expect(parsed.exitCode).toBe(0);
      expect(parsed.stdout).toBe('command output\n');
      expect(parsed.stderr).toBe('');
    });

    it('returns error for non-existent machine', async () => {
      const tools = buildAssistantTools(deps);
      const tool = tools.find((t) => t.name === 'ssh_execute')!;
      const result = await tool.handler({ machineId: 'nonexistent', command: 'ls' });
      expect(result).toContain('Error');
      expect(result).toContain('not found');
    });

    it('caps timeout at 300 seconds', async () => {
      const tools = buildAssistantTools(deps);
      const tool = tools.find((t) => t.name === 'ssh_execute')!;
      await tool.handler({ machineId: 'm1', command: 'sleep 1', timeoutSeconds: 999 });

      expect(deps.sshPool.executeCommand).toHaveBeenCalledWith(
        expect.anything(),
        'sleep 1',
        { timeoutMs: 300_000 },
      );
    });

    it('uses default 30s timeout when not specified', async () => {
      const tools = buildAssistantTools(deps);
      const tool = tools.find((t) => t.name === 'ssh_execute')!;
      await tool.handler({ machineId: 'm1', command: 'ls' });

      expect(deps.sshPool.executeCommand).toHaveBeenCalledWith(
        expect.anything(),
        'ls',
        { timeoutMs: 30_000 },
      );
    });
  });

  describe('list_agents', () => {
    it('lists all agents when no machineId given', async () => {
      const tools = buildAssistantTools(deps);
      const tool = tools.find((t) => t.name === 'list_agents')!;
      const result = await tool.handler({});
      const parsed = JSON.parse(result);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].agentId).toBe('pm');
      expect(parsed[0].machineName).toBe('Beijing');
    });

    it('lists agents for a specific machine', async () => {
      const tools = buildAssistantTools(deps);
      const tool = tools.find((t) => t.name === 'list_agents')!;
      const result = await tool.handler({ machineId: 'm1' });
      const parsed = JSON.parse(result);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].workspacePath).toBe('workspace');
    });
  });

  describe('get_agent_info', () => {
    it('returns agent details', async () => {
      const tools = buildAssistantTools(deps);
      const tool = tools.find((t) => t.name === 'get_agent_info')!;
      const result = await tool.handler({ agentId: 'a1' });
      const parsed = JSON.parse(result);
      expect(parsed.agentId).toBe('pm');
      expect(parsed.name).toBe('PM Bot');
      expect(parsed.machineId).toBe('m1');
    });

    it('returns error for non-existent agent', async () => {
      const tools = buildAssistantTools(deps);
      const tool = tools.find((t) => t.name === 'get_agent_info')!;
      const result = await tool.handler({ agentId: 'nonexistent' });
      expect(result).toContain('not found');
    });
  });

  describe('health_check', () => {
    it('returns health check results', async () => {
      const tools = buildAssistantTools(deps);
      const tool = tools.find((t) => t.name === 'health_check')!;
      const result = await tool.handler({ machineId: 'm1' });
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('online');
      expect(parsed.sshConnectivity).toBe(true);
      expect(parsed.gatewayStatus).toBe('active');
    });
  });

  describe('get_sync_history', () => {
    it('returns sync operations', async () => {
      const tools = buildAssistantTools(deps);
      const tool = tools.find((t) => t.name === 'get_sync_history')!;
      const result = await tool.handler({ machineId: 'm1' });
      const parsed = JSON.parse(result);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].syncType).toBe('hot');
    });

    it('returns message when no operations found', async () => {
      (deps.syncRepo.findOperationsByMachine as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      const tools = buildAssistantTools(deps);
      const tool = tools.find((t) => t.name === 'get_sync_history')!;
      const result = await tool.handler({ machineId: 'm1' });
      expect(result).toContain('No sync operations');
    });
  });
});
