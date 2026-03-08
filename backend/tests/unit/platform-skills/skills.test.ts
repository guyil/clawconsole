import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SkillContext } from '../../../src/shared/platform-skills/types.js';
import { agentCreateSkill } from '../../../src/shared/platform-skills/skills/agent-create.skill.js';
import { channelConfigSkill } from '../../../src/shared/platform-skills/skills/channel-config.skill.js';
import { channelBindSkill } from '../../../src/shared/platform-skills/skills/channel-bind.skill.js';
import { agentDeploySkill } from '../../../src/shared/platform-skills/skills/agent-deploy.skill.js';
import { agentStatusSkill, gatewayRestartSkill } from '../../../src/shared/platform-skills/skills/agent-status.skill.js';

function createMockContext(): SkillContext {
  return {
    sshPool: {
      executeCommand: vi.fn().mockResolvedValue({
        stdout: 'OK',
        stderr: '',
        exitCode: 0,
      }),
    } as unknown as SkillContext['sshPool'],
    machineService: {
      toConnectionInfo: vi.fn().mockReturnValue({
        machineId: 'm1',
        host: 'test.tailnet',
        port: 22,
        username: 'claw',
      }),
    } as unknown as SkillContext['machineService'],
    machineRepo: {
      findById: vi.fn().mockResolvedValue({
        id: 'm1',
        name: 'Test Machine',
        tailscaleHostname: 'test.tailnet',
        sshUser: 'claw',
        sshPort: 22,
        openclawHome: '~/.openclaw',
        status: 'online',
      }),
    } as unknown as SkillContext['machineRepo'],
    agentRepo: {
      findById: vi.fn().mockResolvedValue({
        id: 'a1',
        machineId: 'm1',
        agentId: 'test-bot',
        workspacePath: 'workspace-test-bot',
        status: 'draft',
      }),
      update: vi.fn().mockResolvedValue(null),
      updateSyncTime: vi.fn().mockResolvedValue(undefined),
    } as unknown as SkillContext['agentRepo'],
  };
}

describe('agentCreateSkill', () => {
  let ctx: SkillContext;

  beforeEach(() => {
    ctx = createMockContext();
  });

  it('has correct metadata', () => {
    expect(agentCreateSkill.name).toBe('create_agent_on_node');
    expect(agentCreateSkill.description).toContain('openclaw agent');
  });

  it('returns error if machineId or agentId is missing', async () => {
    const result = await agentCreateSkill.handler({ machineId: '', agentId: '' }, ctx);
    expect(result).toContain('Error');
  });

  it('creates agent via SSH and updates DB status', async () => {
    const result = await agentCreateSkill.handler(
      { machineId: 'm1', agentId: 'test-bot', dbRecordId: 'a1' },
      ctx,
    );
    const parsed = JSON.parse(result);

    expect(parsed.success).toBe(true);
    expect(parsed.agentId).toBe('test-bot');
    expect(ctx.agentRepo.update).toHaveBeenCalledWith('a1', { status: 'packaging' });
    expect(ctx.sshPool.executeCommand).toHaveBeenCalled();

    // Verify the SSH command contains 'openclaw agents add'
    const sshCall = (ctx.sshPool.executeCommand as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(sshCall[1]).toContain('openclaw agents add');
    expect(sshCall[1]).toContain('test-bot');
    expect(sshCall[1]).toContain('--non-interactive');
  });

  it('reverts status on SSH failure', async () => {
    (ctx.sshPool.executeCommand as ReturnType<typeof vi.fn>).mockResolvedValue({
      stdout: '',
      stderr: 'Agent already exists',
      exitCode: 1,
    });

    const result = await agentCreateSkill.handler(
      { machineId: 'm1', agentId: 'test-bot', dbRecordId: 'a1' },
      ctx,
    );
    expect(result).toContain('Error');
    expect(ctx.agentRepo.update).toHaveBeenCalledWith('a1', { status: 'draft' });
  });
});

describe('channelConfigSkill', () => {
  let ctx: SkillContext;

  beforeEach(() => {
    ctx = createMockContext();
  });

  it('has correct metadata', () => {
    expect(channelConfigSkill.name).toBe('configure_channel');
  });

  it('returns error for missing params', async () => {
    const result = await channelConfigSkill.handler({ machineId: '', channelType: '' }, ctx);
    expect(result).toContain('Error');
  });

  it('requires token for telegram/discord/slack', async () => {
    const result = await channelConfigSkill.handler(
      { machineId: 'm1', channelType: 'telegram', accountId: 'default' },
      ctx,
    );
    expect(result).toContain('requires a token');
  });

  it('handles whatsapp as interactive-only', async () => {
    const result = await channelConfigSkill.handler(
      { machineId: 'm1', channelType: 'whatsapp', accountId: 'default' },
      ctx,
    );
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.requiresInteractiveSetup).toBe(true);
  });

  it('configures telegram with token via SSH', async () => {
    const result = await channelConfigSkill.handler(
      { machineId: 'm1', channelType: 'telegram', accountId: 'work', token: '123:ABC' },
      ctx,
    );
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.channelType).toBe('telegram');
    expect(ctx.sshPool.executeCommand).toHaveBeenCalled();
  });

  it('requires token for feishu', async () => {
    const result = await channelConfigSkill.handler(
      { machineId: 'm1', channelType: 'feishu', accountId: 'default' },
      ctx,
    );
    expect(result).toContain('requires a token');
  });

  it('requires appSecret for feishu', async () => {
    const result = await channelConfigSkill.handler(
      { machineId: 'm1', channelType: 'feishu', accountId: 'default', token: 'cli_xxx' },
      ctx,
    );
    expect(result).toContain('appSecret');
  });

  it('configures feishu with appId, appSecret and encryptKey via SSH', async () => {
    const result = await channelConfigSkill.handler(
      {
        machineId: 'm1',
        channelType: 'feishu',
        accountId: 'default',
        token: 'cli_xxx',
        signingSecret: 'secret123',
        encryptKey: 'enc456',
      },
      ctx,
    );
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.channelType).toBe('feishu');

    // Single jq call sets appId + appSecret + encryptKey together
    const sshCalls = (ctx.sshPool.executeCommand as ReturnType<typeof vi.fn>).mock.calls;
    expect(sshCalls.length).toBeGreaterThanOrEqual(1);
    const jqCommand = sshCalls[0][1] as string;
    expect(jqCommand).toContain('appId');
    expect(jqCommand).toContain('appSecret');
    expect(jqCommand).toContain('encryptKey');
  });
});

describe('channelBindSkill', () => {
  let ctx: SkillContext;

  beforeEach(() => {
    ctx = createMockContext();
  });

  it('has correct metadata', () => {
    expect(channelBindSkill.name).toBe('bind_channel_to_agent');
  });

  it('returns error for missing bindings', async () => {
    const result = await channelBindSkill.handler(
      { machineId: 'm1', agentId: 'bot', bindings: '' },
      ctx,
    );
    expect(result).toContain('Error');
  });

  it('binds channels via SSH', async () => {
    const result = await channelBindSkill.handler(
      { machineId: 'm1', agentId: 'test-bot', bindings: 'telegram:work,discord:guild-a' },
      ctx,
    );
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.bindings).toEqual(['telegram:work', 'discord:guild-a']);

    const sshCall = (ctx.sshPool.executeCommand as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(sshCall[1]).toContain('openclaw agents bind');
    expect(sshCall[1]).toContain('--bind telegram:work');
  });
});

describe('agentDeploySkill', () => {
  let ctx: SkillContext;

  beforeEach(() => {
    ctx = createMockContext();
  });

  it('has correct metadata', () => {
    expect(agentDeploySkill.name).toBe('deploy_agent');
  });

  it('deploys agent, creates workspace, writes config, restarts gateway', async () => {
    const result = await agentDeploySkill.handler(
      { machineId: 'm1', agentId: 'test-bot', dbRecordId: 'a1', identityName: 'Test Bot' },
      ctx,
    );
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);

    // Should update status to syncing then online
    expect(ctx.agentRepo.update).toHaveBeenCalledWith('a1', { status: 'syncing' });
    expect(ctx.agentRepo.update).toHaveBeenCalledWith('a1', { status: 'online' });
    expect(ctx.agentRepo.updateSyncTime).toHaveBeenCalledWith('a1');

    // Multiple SSH commands: mkdir, SOUL.md, IDENTITY.md, gateway restart
    expect((ctx.sshPool.executeCommand as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(3);
  });
});

describe('agentStatusSkill', () => {
  let ctx: SkillContext;

  beforeEach(() => {
    ctx = createMockContext();
  });

  it('checks agent and channel status', async () => {
    const result = await agentStatusSkill.handler({ machineId: 'm1' }, ctx);
    const parsed = JSON.parse(result);
    expect(parsed.agents).toBeDefined();
    expect(parsed.channels).toBeDefined();
    expect(parsed.agents.success).toBe(true);
  });

  it('returns error for missing machineId', async () => {
    const result = await agentStatusSkill.handler({ machineId: '' }, ctx);
    expect(result).toContain('Error');
  });
});

describe('gatewayRestartSkill', () => {
  let ctx: SkillContext;

  beforeEach(() => {
    ctx = createMockContext();
  });

  it('restarts gateway via SSH', async () => {
    const result = await gatewayRestartSkill.handler({ machineId: 'm1' }, ctx);
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);

    const sshCall = (ctx.sshPool.executeCommand as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(sshCall[1]).toContain('openclaw gateway restart');
  });
});
