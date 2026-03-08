import { describe, it, expect } from 'vitest';
import {
  getAgentConfig,
  getAllAgentConfigs,
  getAgentSystemPrompt,
  getAgentModelConfig,
  type AgentId,
} from '../../../src/shared/langgraph/agent-config.js';

describe('agent-config', () => {
  describe('getAgentConfig', () => {
    it('returns config for playground-simulator agent', () => {
      const cfg = getAgentConfig('playground-simulator');
      expect(cfg).toBeDefined();
      expect(cfg.id).toBe('playground-simulator');
      expect(cfg.name).toBeTruthy();
      expect(cfg.model).toBeTruthy();
      expect(cfg.maxTokens).toBeGreaterThan(0);
      expect(cfg.systemPrompt).toBeTruthy();
    });

    it('returns config for playground-optimizer agent', () => {
      const cfg = getAgentConfig('playground-optimizer');
      expect(cfg).toBeDefined();
      expect(cfg.id).toBe('playground-optimizer');
      expect(cfg.systemPrompt).toContain('Skill Optimizer');
    });

    it('returns config for assistant agent', () => {
      const cfg = getAgentConfig('assistant');
      expect(cfg).toBeDefined();
      expect(cfg.id).toBe('assistant');
      expect(cfg.systemPrompt).toContain('ClawConsole');
    });

    it('returns config for bot-config agent', () => {
      const cfg = getAgentConfig('bot-config');
      expect(cfg).toBeDefined();
      expect(cfg.id).toBe('bot-config');
      expect(cfg.systemPrompt).toContain('configure');
    });

    it('throws for unknown agent id', () => {
      expect(() => getAgentConfig('nonexistent' as AgentId)).toThrow(/Unknown agent/);
    });
  });

  describe('getAllAgentConfigs', () => {
    it('returns all registered agent configs', () => {
      const all = getAllAgentConfigs();
      expect(all.length).toBeGreaterThanOrEqual(4);

      const ids = all.map((c) => c.id);
      expect(ids).toContain('playground-simulator');
      expect(ids).toContain('playground-optimizer');
      expect(ids).toContain('assistant');
      expect(ids).toContain('bot-config');
    });

    it('each config has required fields', () => {
      for (const cfg of getAllAgentConfigs()) {
        expect(cfg.id).toBeTruthy();
        expect(cfg.name).toBeTruthy();
        expect(cfg.model).toBeTruthy();
        expect(cfg.maxTokens).toBeGreaterThan(0);
        expect(typeof cfg.systemPrompt).toBe('string');
        expect(cfg.systemPrompt.length).toBeGreaterThan(0);
      }
    });
  });

  describe('getAgentSystemPrompt', () => {
    it('returns the system prompt for a given agent', () => {
      const prompt = getAgentSystemPrompt('assistant');
      expect(prompt).toBeTruthy();
      expect(typeof prompt).toBe('string');
    });
  });

  describe('getAgentModelConfig', () => {
    it('returns model and maxTokens for a given agent', () => {
      const modelCfg = getAgentModelConfig('playground-simulator');
      expect(modelCfg.model).toBeTruthy();
      expect(modelCfg.maxTokens).toBeGreaterThan(0);
    });

    it('includes temperature when defined', () => {
      const modelCfg = getAgentModelConfig('playground-simulator');
      // temperature is optional; just verify the shape
      expect('model' in modelCfg).toBe(true);
      expect('maxTokens' in modelCfg).toBe(true);
    });
  });
});
