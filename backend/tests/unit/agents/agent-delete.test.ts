import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Agent } from '../../../src/modules/agents/agent.types.js';

function makeFakeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'uuid-1',
    machineId: 'm1',
    agentId: 'test-bot',
    name: 'Test Bot',
    description: null,
    isDefault: false,
    workspacePath: 'workspace-test-bot',
    discoveredSkills: null,
    modelConfig: null,
    status: 'draft',
    lastSyncedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

interface DeleteAgentDeps {
  agentRepo: { findById: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };
  machineRepo: { findById: ReturnType<typeof vi.fn> };
  fileTransfer: { removeDirectory: ReturnType<typeof vi.fn> };
  machineService: { toConnectionInfo: ReturnType<typeof vi.fn> };
}

async function deleteAgent(deps: DeleteAgentDeps, agentId: string, cleanRemote: boolean) {
  const agent = await deps.agentRepo.findById(agentId);
  if (!agent) throw new Error('Agent not found');

  let remoteCleanupFailed = false;

  if (cleanRemote && agent.workspacePath) {
    const machine = await deps.machineRepo.findById(agent.machineId);
    if (!machine) throw new Error('Machine not found');

    const connInfo = deps.machineService.toConnectionInfo(machine);
    const remotePath = `${machine.openclawHome}/${agent.workspacePath}`;
    try {
      await deps.fileTransfer.removeDirectory(connInfo, remotePath);
    } catch {
      remoteCleanupFailed = true;
    }
  }

  await deps.agentRepo.delete(agentId);
  return remoteCleanupFailed ? { deleted: true, remoteCleanupFailed: true } : { deleted: true };
}

describe('Agent delete logic', () => {
  let deps: DeleteAgentDeps;

  beforeEach(() => {
    deps = {
      agentRepo: { findById: vi.fn(), delete: vi.fn() },
      machineRepo: { findById: vi.fn() },
      fileTransfer: { removeDirectory: vi.fn() },
      machineService: { toConnectionInfo: vi.fn() },
    };
  });

  it('throws if agent not found', async () => {
    deps.agentRepo.findById.mockResolvedValue(null);
    await expect(deleteAgent(deps, 'nonexistent', false)).rejects.toThrow('Agent not found');
  });

  it('deletes DB record without remote cleanup when cleanRemote=false', async () => {
    const agent = makeFakeAgent();
    deps.agentRepo.findById.mockResolvedValue(agent);
    deps.agentRepo.delete.mockResolvedValue(true);

    const result = await deleteAgent(deps, 'uuid-1', false);

    expect(result).toEqual({ deleted: true });
    expect(deps.agentRepo.delete).toHaveBeenCalledWith('uuid-1');
    expect(deps.fileTransfer.removeDirectory).not.toHaveBeenCalled();
  });

  it('deletes DB record AND remote workspace when cleanRemote=true', async () => {
    const agent = makeFakeAgent();
    const machine = { id: 'm1', openclawHome: '~/.openclaw' };
    const connInfo = { machineId: 'm1', host: 'test-host' };

    deps.agentRepo.findById.mockResolvedValue(agent);
    deps.machineRepo.findById.mockResolvedValue(machine);
    deps.machineService.toConnectionInfo.mockReturnValue(connInfo);
    deps.fileTransfer.removeDirectory.mockResolvedValue(undefined);
    deps.agentRepo.delete.mockResolvedValue(true);

    const result = await deleteAgent(deps, 'uuid-1', true);

    expect(result).toEqual({ deleted: true });
    expect(deps.fileTransfer.removeDirectory).toHaveBeenCalledWith(
      connInfo,
      '~/.openclaw/workspace-test-bot',
    );
    expect(deps.agentRepo.delete).toHaveBeenCalledWith('uuid-1');
  });

  it('skips remote cleanup if agent has no workspacePath', async () => {
    const agent = makeFakeAgent({ workspacePath: null });
    deps.agentRepo.findById.mockResolvedValue(agent);
    deps.agentRepo.delete.mockResolvedValue(true);

    const result = await deleteAgent(deps, 'uuid-1', true);

    expect(result).toEqual({ deleted: true });
    expect(deps.fileTransfer.removeDirectory).not.toHaveBeenCalled();
  });

  it('still deletes DB record even if remote cleanup fails', async () => {
    const agent = makeFakeAgent();
    const machine = { id: 'm1', openclawHome: '~/.openclaw' };
    const connInfo = { machineId: 'm1', host: 'test-host' };

    deps.agentRepo.findById.mockResolvedValue(agent);
    deps.machineRepo.findById.mockResolvedValue(machine);
    deps.machineService.toConnectionInfo.mockReturnValue(connInfo);
    deps.fileTransfer.removeDirectory.mockRejectedValue(new Error('SSH timeout'));
    deps.agentRepo.delete.mockResolvedValue(true);

    // Should NOT throw — remote failure is non-fatal
    const result = await deleteAgent(deps, 'uuid-1', true);
    expect(result).toEqual({ deleted: true, remoteCleanupFailed: true });
    expect(deps.agentRepo.delete).toHaveBeenCalledWith('uuid-1');
  });
});
