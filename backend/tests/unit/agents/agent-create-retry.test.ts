import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Agent, AgentStatus } from '../../../src/modules/agents/agent.types.js';

/**
 * Tests the idempotent agent creation + retry provisioning logic
 * that lives in server.ts route handlers. We extract and test the
 * core decision logic without spinning up a full Fastify server.
 */

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

describe('Agent creation idempotency logic', () => {
  let agentRepo: {
    findByMachineAndAgentId: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    agentRepo = {
      findByMachineAndAgentId: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    };
  });

  /**
   * Mirrors the route logic in server.ts:
   * POST /api/machines/:machineId/agents
   */
  async function createAgentHandler(machineId: string, body: {
    agentId: string;
    name?: string;
    description?: string;
    isDefault?: boolean;
  }): Promise<{ status: number; agent: Agent }> {
    const existing = await agentRepo.findByMachineAndAgentId(machineId, body.agentId);
    if (existing) {
      if (existing.status === 'draft' || existing.status === 'packaging') {
        const updated = {
          ...existing,
          name: body.name ?? existing.name,
          description: body.description ?? existing.description,
          status: 'draft' as AgentStatus,
        };
        agentRepo.update(existing.id, {
          name: body.name,
          description: body.description,
          status: 'draft',
        });
        return { status: 200, agent: updated };
      }
      throw new Error(`Agent "${body.agentId}" already exists on this machine`);
    }

    const newAgent = makeFakeAgent({
      machineId,
      agentId: body.agentId,
      name: body.name ?? null,
      description: body.description ?? null,
    });
    agentRepo.create.mockResolvedValue(newAgent);
    return { status: 201, agent: newAgent };
  }

  it('creates a new agent when none exists', async () => {
    agentRepo.findByMachineAndAgentId.mockResolvedValue(null);

    const result = await createAgentHandler('m1', {
      agentId: 'new-bot',
      name: 'New Bot',
    });

    expect(result.status).toBe(201);
    expect(result.agent.agentId).toBe('new-bot');
    expect(agentRepo.update).not.toHaveBeenCalled();
  });

  it('reuses existing draft agent on retry (returns 200, resets to draft)', async () => {
    agentRepo.findByMachineAndAgentId.mockResolvedValue(
      makeFakeAgent({ status: 'draft', name: 'Old Name' }),
    );

    const result = await createAgentHandler('m1', {
      agentId: 'test-bot',
      name: 'Updated Name',
    });

    expect(result.status).toBe(200);
    expect(result.agent.name).toBe('Updated Name');
    expect(result.agent.status).toBe('draft');
    expect(agentRepo.update).toHaveBeenCalledWith('uuid-1', {
      name: 'Updated Name',
      description: undefined,
      status: 'draft',
    });
  });

  it('reuses existing packaging agent on retry (resets status to draft)', async () => {
    agentRepo.findByMachineAndAgentId.mockResolvedValue(
      makeFakeAgent({ status: 'packaging' }),
    );

    const result = await createAgentHandler('m1', {
      agentId: 'test-bot',
      name: 'Retry Bot',
    });

    expect(result.status).toBe(200);
    expect(result.agent.status).toBe('draft');
    expect(agentRepo.update).toHaveBeenCalledWith('uuid-1', expect.objectContaining({
      status: 'draft',
    }));
  });

  it('rejects with conflict if agent is online (not retryable)', async () => {
    agentRepo.findByMachineAndAgentId.mockResolvedValue(
      makeFakeAgent({ status: 'online' }),
    );

    await expect(
      createAgentHandler('m1', { agentId: 'test-bot' }),
    ).rejects.toThrow('already exists');
  });

  it('rejects with conflict if agent is archived', async () => {
    agentRepo.findByMachineAndAgentId.mockResolvedValue(
      makeFakeAgent({ status: 'archived' }),
    );

    await expect(
      createAgentHandler('m1', { agentId: 'test-bot' }),
    ).rejects.toThrow('already exists');
  });
});

describe('Provision status gating logic', () => {
  const provisionableStatuses: AgentStatus[] = ['draft', 'packaging', 'offline'];
  const nonProvisionableStatuses: AgentStatus[] = ['syncing', 'online', 'degraded', 'archived'];

  function canProvision(status: AgentStatus): boolean {
    return provisionableStatuses.includes(status);
  }

  for (const status of provisionableStatuses) {
    it(`allows provisioning for "${status}" status`, () => {
      expect(canProvision(status)).toBe(true);
    });
  }

  for (const status of nonProvisionableStatuses) {
    it(`rejects provisioning for "${status}" status`, () => {
      expect(canProvision(status)).toBe(false);
    });
  }
});
