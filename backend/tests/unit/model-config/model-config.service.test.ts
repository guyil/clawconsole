import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentModelValue } from '../../../src/modules/agents/agent.types.js';

/**
 * Tests the model config merge logic used by ModelConfigService
 * when reading/writing openclaw.json model settings.
 */

interface OpenClawJson {
  agents?: {
    defaults?: { model?: AgentModelValue; [k: string]: unknown };
    list?: Array<{ id: string; model?: AgentModelValue; [k: string]: unknown }>;
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

function mergeGlobalModel(json: OpenClawJson, model: AgentModelValue): OpenClawJson {
  const result = { ...json };
  if (!result.agents) result.agents = {};
  if (!result.agents.defaults) result.agents.defaults = {};
  result.agents.defaults.model = model;
  return result;
}

function mergeAgentModel(json: OpenClawJson, agentId: string, model: AgentModelValue): OpenClawJson {
  const result = { ...json };
  if (!result.agents) result.agents = {};
  if (!result.agents.list) result.agents.list = [];

  const existingIdx = result.agents.list.findIndex((a) => a.id === agentId);
  if (existingIdx >= 0) {
    result.agents.list = [...result.agents.list];
    result.agents.list[existingIdx] = { ...result.agents.list[existingIdx], model };
  } else {
    result.agents.list = [...result.agents.list, { id: agentId, model }];
  }
  return result;
}

function removeAgentModel(json: OpenClawJson, agentId: string): OpenClawJson {
  const result = { ...json };
  if (result.agents?.list) {
    result.agents = { ...result.agents };
    result.agents.list = result.agents.list
      .map((a) => {
        if (a.id !== agentId) return a;
        const { model, ...rest } = a;
        return rest;
      })
      .filter((a) => Object.keys(a).length > 1 || a.id !== agentId);
  }
  return result;
}

describe('mergeGlobalModel', () => {
  it('sets model on empty config', () => {
    const result = mergeGlobalModel({}, 'anthropic/claude-opus-4-6');
    expect(result.agents?.defaults?.model).toBe('anthropic/claude-opus-4-6');
  });

  it('overwrites existing global model', () => {
    const existing: OpenClawJson = {
      agents: { defaults: { model: 'openai/gpt-4.1' } },
    };
    const result = mergeGlobalModel(existing, 'anthropic/claude-sonnet-4-6');
    expect(result.agents?.defaults?.model).toBe('anthropic/claude-sonnet-4-6');
  });

  it('preserves other config fields', () => {
    const existing: OpenClawJson = {
      agents: {
        defaults: { model: 'old', imageModel: 'some-img-model' },
        list: [{ id: 'main', model: 'openai/gpt-5.2' }],
      },
      models: { providers: {} },
    };
    const result = mergeGlobalModel(existing, 'anthropic/claude-opus-4-6');
    expect(result.agents?.defaults?.model).toBe('anthropic/claude-opus-4-6');
    expect(result.agents?.defaults?.imageModel).toBe('some-img-model');
    expect(result.agents?.list).toHaveLength(1);
    expect(result.models).toEqual({ providers: {} });
  });

  it('supports model with fallbacks', () => {
    const model = { primary: 'anthropic/claude-opus-4-6', fallbacks: ['openai/gpt-4.1'] };
    const result = mergeGlobalModel({}, model);
    expect(result.agents?.defaults?.model).toEqual(model);
  });
});

describe('mergeAgentModel', () => {
  it('adds a new agent entry when list is empty', () => {
    const result = mergeAgentModel({}, 'my-bot', 'openai/gpt-5.2');
    expect(result.agents?.list).toHaveLength(1);
    expect(result.agents?.list?.[0]).toEqual({ id: 'my-bot', model: 'openai/gpt-5.2' });
  });

  it('updates existing agent model', () => {
    const existing: OpenClawJson = {
      agents: {
        list: [
          { id: 'bot-a', model: 'old-model' },
          { id: 'bot-b', model: 'other' },
        ],
      },
    };
    const result = mergeAgentModel(existing, 'bot-a', 'anthropic/claude-opus-4-6');
    expect(result.agents?.list).toHaveLength(2);
    expect(result.agents?.list?.[0].model).toBe('anthropic/claude-opus-4-6');
    expect(result.agents?.list?.[1].model).toBe('other');
  });

  it('appends to list when agent not found', () => {
    const existing: OpenClawJson = {
      agents: {
        list: [{ id: 'bot-a', model: 'model-a' }],
      },
    };
    const result = mergeAgentModel(existing, 'bot-b', 'model-b');
    expect(result.agents?.list).toHaveLength(2);
    expect(result.agents?.list?.[1]).toEqual({ id: 'bot-b', model: 'model-b' });
  });

  it('preserves other agent fields when updating', () => {
    const existing: OpenClawJson = {
      agents: {
        list: [{ id: 'bot-a', model: 'old', subagents: { model: 'sub' } }],
      },
    };
    const result = mergeAgentModel(existing, 'bot-a', 'new-model');
    const entry = result.agents?.list?.[0] as Record<string, unknown>;
    expect(entry.model).toBe('new-model');
    expect(entry.subagents).toEqual({ model: 'sub' });
  });
});

describe('removeAgentModel', () => {
  it('removes model from agent entry', () => {
    const existing: OpenClawJson = {
      agents: {
        list: [
          { id: 'bot-a', model: 'model-a' },
          { id: 'bot-b', model: 'model-b' },
        ],
      },
    };
    const result = removeAgentModel(existing, 'bot-a');
    // bot-a had only id+model, removing model leaves only id → filtered out
    expect(result.agents?.list).toHaveLength(1);
    expect(result.agents?.list?.[0].id).toBe('bot-b');
  });

  it('keeps agent entry if it has other fields', () => {
    const existing: OpenClawJson = {
      agents: {
        list: [{ id: 'bot-a', model: 'model-a', subagents: { model: 'sub' } }],
      },
    };
    const result = removeAgentModel(existing, 'bot-a');
    expect(result.agents?.list).toHaveLength(1);
    const entry = result.agents?.list?.[0] as Record<string, unknown>;
    expect(entry.model).toBeUndefined();
    expect(entry.subagents).toEqual({ model: 'sub' });
  });

  it('handles missing list gracefully', () => {
    const result = removeAgentModel({}, 'bot-a');
    expect(result.agents?.list).toBeUndefined();
  });

  it('handles agent not in list gracefully', () => {
    const existing: OpenClawJson = {
      agents: { list: [{ id: 'bot-b', model: 'model-b' }] },
    };
    const result = removeAgentModel(existing, 'bot-a');
    expect(result.agents?.list).toHaveLength(1);
    expect(result.agents?.list?.[0].id).toBe('bot-b');
  });
});

describe('model value parsing', () => {
  it('parses string model value', () => {
    const model: AgentModelValue = 'anthropic/claude-opus-4-6';
    expect(typeof model).toBe('string');
  });

  it('parses object model value with fallbacks', () => {
    const model: AgentModelValue = {
      primary: 'anthropic/claude-opus-4-6',
      fallbacks: ['openai/gpt-4.1'],
    };
    expect(typeof model).toBe('object');
    expect((model as { primary: string }).primary).toBe('anthropic/claude-opus-4-6');
    expect((model as { fallbacks: string[] }).fallbacks).toHaveLength(1);
  });

  it('parses object model value without fallbacks', () => {
    const model: AgentModelValue = { primary: 'anthropic/claude-opus-4-6' };
    expect((model as { primary: string }).primary).toBe('anthropic/claude-opus-4-6');
    expect((model as { fallbacks?: string[] }).fallbacks).toBeUndefined();
  });
});
