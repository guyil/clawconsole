import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getTracingConfig, getRunConfig, initTracing } from '../../../src/shared/langgraph/tracing.js';

describe('tracing', () => {
  const savedEnv: Record<string, string | undefined> = {};
  const tracingKeys = [
    'LANGSMITH_API_KEY',
    'LANGSMITH_PROJECT',
    'LANGSMITH_TRACING',
    'LANGSMITH_ENDPOINT',
    'LANGCHAIN_TRACING_V2',
    'LANGCHAIN_API_KEY',
    'LANGCHAIN_PROJECT',
    'LANGCHAIN_ENDPOINT',
  ];

  beforeEach(() => {
    for (const k of tracingKeys) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of tracingKeys) {
      if (savedEnv[k] === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = savedEnv[k];
      }
    }
  });

  it('getTracingConfig returns config from env vars', () => {
    process.env.LANGSMITH_API_KEY = 'test-key-123';
    process.env.LANGSMITH_PROJECT = 'test-project';
    process.env.LANGSMITH_TRACING = 'true';

    const cfg = getTracingConfig();

    expect(cfg.enabled).toBe(true);
    expect(cfg.apiKey).toBe('test-key-123');
    expect(cfg.project).toBe('test-project');
  });

  it('getTracingConfig returns disabled when no API key', () => {
    const cfg = getTracingConfig();
    expect(cfg.enabled).toBe(false);
  });

  it('getTracingConfig uses default project name', () => {
    process.env.LANGSMITH_API_KEY = 'test-key-123';
    process.env.LANGSMITH_TRACING = 'true';

    const cfg = getTracingConfig();
    expect(cfg.project).toBe('clawconsole');
  });

  it('getRunConfig returns run metadata with agent info', () => {
    const runCfg = getRunConfig('assistant', 'session-abc');

    expect(runCfg.runName).toBe('assistant');
    expect(runCfg.metadata?.agentId).toBe('assistant');
    expect(runCfg.metadata?.sessionId).toBe('session-abc');
    expect(runCfg.tags).toContain('assistant');
  });

  it('initTracing sets environment variables for LangChain', () => {
    process.env.LANGSMITH_API_KEY = 'test-key-123';
    process.env.LANGSMITH_TRACING = 'true';
    process.env.LANGSMITH_PROJECT = 'my-proj';

    initTracing();

    expect(process.env.LANGCHAIN_TRACING_V2).toBe('true');
    expect(process.env.LANGCHAIN_API_KEY).toBe('test-key-123');
    expect(process.env.LANGCHAIN_PROJECT).toBe('my-proj');
  });

  it('initTracing does nothing when disabled', () => {
    initTracing();
    expect(process.env.LANGCHAIN_TRACING_V2).toBeUndefined();
  });
});
