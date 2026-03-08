import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PlatformSkillRegistry } from '../../../src/shared/platform-skills/registry.js';
import type { PlatformSkill, SkillContext } from '../../../src/shared/platform-skills/types.js';

function createMockContext(): SkillContext {
  return {
    sshPool: {
      executeCommand: vi.fn(),
      getConnection: vi.fn(),
      releaseConnection: vi.fn(),
      destroy: vi.fn(),
    } as unknown as SkillContext['sshPool'],
    machineService: {
      toConnectionInfo: vi.fn(),
    } as unknown as SkillContext['machineService'],
    machineRepo: {
      findById: vi.fn(),
    } as unknown as SkillContext['machineRepo'],
    agentRepo: {
      findById: vi.fn(),
      update: vi.fn(),
    } as unknown as SkillContext['agentRepo'],
  };
}

function createTestSkill(name: string): PlatformSkill {
  return {
    name,
    description: `Test skill: ${name}`,
    schema: { input: { type: 'string', description: 'Test input' } },
    handler: vi.fn().mockResolvedValue(JSON.stringify({ success: true, skill: name })),
  };
}

describe('PlatformSkillRegistry', () => {
  let ctx: SkillContext;
  let registry: PlatformSkillRegistry;

  beforeEach(() => {
    ctx = createMockContext();
    registry = new PlatformSkillRegistry(ctx);
  });

  it('registers and retrieves a skill', () => {
    const skill = createTestSkill('test_skill');
    registry.register(skill);

    expect(registry.has('test_skill')).toBe(true);
    expect(registry.get('test_skill')).toBe(skill);
  });

  it('returns undefined for unregistered skills', () => {
    expect(registry.get('nonexistent')).toBeUndefined();
    expect(registry.has('nonexistent')).toBe(false);
  });

  it('lists all registered skill names', () => {
    registry.register(createTestSkill('alpha'));
    registry.register(createTestSkill('beta'));
    registry.register(createTestSkill('gamma'));

    expect(registry.listNames()).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('registers multiple skills at once', () => {
    registry.registerAll([
      createTestSkill('one'),
      createTestSkill('two'),
      createTestSkill('three'),
    ]);

    expect(registry.listNames()).toHaveLength(3);
  });

  it('converts all skills to LangGraph tools when no names specified', () => {
    registry.registerAll([
      createTestSkill('skill_a'),
      createTestSkill('skill_b'),
    ]);

    const tools = registry.toLangGraphTools();
    expect(tools).toHaveLength(2);
    expect(tools[0].name).toBe('skill_a');
    expect(tools[1].name).toBe('skill_b');
  });

  it('converts selected skills to LangGraph tools by name', () => {
    registry.registerAll([
      createTestSkill('skill_a'),
      createTestSkill('skill_b'),
      createTestSkill('skill_c'),
    ]);

    const tools = registry.toLangGraphTools(['skill_a', 'skill_c']);
    expect(tools).toHaveLength(2);
    expect(tools.map((t) => t.name)).toEqual(['skill_a', 'skill_c']);
  });

  it('ignores unknown names when converting to LangGraph tools', () => {
    registry.register(createTestSkill('real_skill'));

    const tools = registry.toLangGraphTools(['real_skill', 'fake_skill']);
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('real_skill');
  });

  it('converted tools call the handler with bound context', async () => {
    const skill = createTestSkill('bound_skill');
    registry.register(skill);

    const [tool] = registry.toLangGraphTools(['bound_skill']);
    const result = await tool.handler({ input: 'test' });

    expect(skill.handler).toHaveBeenCalledWith({ input: 'test' }, ctx);
    expect(result).toContain('bound_skill');
  });

  it('exposes the underlying context', () => {
    expect(registry.getContext()).toBe(ctx);
  });

  it('overwrites skill with same name', () => {
    const skill1 = createTestSkill('dup');
    const skill2 = createTestSkill('dup');
    skill2.description = 'overwritten';

    registry.register(skill1);
    registry.register(skill2);

    expect(registry.get('dup')?.description).toBe('overwritten');
    expect(registry.listNames()).toHaveLength(1);
  });
});
