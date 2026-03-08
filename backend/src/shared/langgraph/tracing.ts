/**
 * LangSmith tracing integration.
 *
 * Reads tracing config from environment variables and provides helpers
 * to generate per-run metadata (agent id, session id, tags) that flows
 * into LangSmith for monitoring and debugging.
 *
 * Call `initTracing()` once at startup to set the LangChain env vars
 * that the SDK reads automatically.
 */

import { createChildLogger } from '../logger.js';

const log = createChildLogger('tracing');

export interface TracingConfig {
  enabled: boolean;
  apiKey: string;
  project: string;
  endpoint?: string;
}

export interface RunConfig {
  runName: string;
  tags: string[];
  metadata: Record<string, string>;
}

/**
 * Reads LangSmith configuration from environment variables.
 *
 * Expected env vars:
 *   LANGSMITH_API_KEY     — LangSmith API key (required to enable)
 *   LANGSMITH_PROJECT     — Project name (default: "clawconsole")
 *   LANGSMITH_TRACING     — Explicit enable flag ("true" to enable)
 *   LANGSMITH_ENDPOINT    — Custom endpoint URL (optional)
 */
export function getTracingConfig(): TracingConfig {
  const apiKey = process.env.LANGSMITH_API_KEY ?? '';
  const project = process.env.LANGSMITH_PROJECT ?? 'clawconsole';
  const endpoint = process.env.LANGSMITH_ENDPOINT;
  const enabled = apiKey.length > 0 && process.env.LANGSMITH_TRACING === 'true';

  return { enabled, apiKey, project, endpoint };
}

/**
 * Builds run-level config (name, tags, metadata) for a single agent
 * invocation. Pass this into the LangGraph `.stream()` or `.invoke()`
 * call so each run is labeled in LangSmith.
 */
export function getRunConfig(agentId: string, sessionId?: string): RunConfig {
  const metadata: Record<string, string> = { agentId };
  if (sessionId) metadata.sessionId = sessionId;

  return {
    runName: agentId,
    tags: [agentId],
    metadata,
  };
}

/**
 * Sets the LangChain environment variables so the SDK auto-instruments
 * all LLM calls.  Should be called once during application bootstrap.
 */
export function initTracing(): void {
  const cfg = getTracingConfig();
  if (!cfg.enabled) {
    log.info('LangSmith tracing is disabled (set LANGSMITH_API_KEY + LANGSMITH_TRACING=true to enable)');
    return;
  }

  process.env.LANGCHAIN_TRACING_V2 = 'true';
  process.env.LANGCHAIN_API_KEY = cfg.apiKey;
  process.env.LANGCHAIN_PROJECT = cfg.project;
  if (cfg.endpoint) {
    process.env.LANGCHAIN_ENDPOINT = cfg.endpoint;
  }

  log.info({ project: cfg.project }, 'LangSmith tracing enabled');
}
