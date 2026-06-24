import { describe, it, expect } from 'vitest';
import { authorizeDeveloper } from '../../../src/modules/auth/authz.js';
import type { AuthScope } from '../../../src/modules/users/user.service.js';

const scope: AuthScope = {
  agentUuids: ['agent-1', 'agent-2'],
  agentKeys: [['m1', 'pm'], ['m1', 'sales']],
  machineIds: ['m1'],
};

describe('authorizeDeveloper (default-deny)', () => {
  it('allows GET on the agents list', () => {
    expect(authorizeDeveloper('GET', '/api/agents', scope).ok).toBe(true);
  });

  it('allows GET on an assigned bot and its subpaths', () => {
    expect(authorizeDeveloper('GET', '/api/agents/agent-1', scope).ok).toBe(true);
    expect(authorizeDeveloper('GET', '/api/agents/agent-2/config-files', scope).ok).toBe(true);
  });

  it('denies GET on a bot that is not assigned', () => {
    expect(authorizeDeveloper('GET', '/api/agents/agent-999', scope).ok).toBe(false);
  });

  it('allows GET on monitoring and summaries', () => {
    expect(authorizeDeveloper('GET', '/api/monitoring/sessions', scope).ok).toBe(true);
    expect(authorizeDeveloper('GET', '/api/summaries', scope).ok).toBe(true);
    expect(authorizeDeveloper('GET', '/api/summaries/42', scope).ok).toBe(true);
  });

  it('allows GET on the node list (handler scopes + redacts)', () => {
    expect(authorizeDeveloper('GET', '/api/machines', scope).ok).toBe(true);
  });

  it('allows on-demand monitoring sync POSTs (handler re-checks scope)', () => {
    expect(authorizeDeveloper('POST', '/api/monitoring/sync/sessions', scope).ok).toBe(true);
    expect(authorizeDeveloper('POST', '/api/monitoring/sync/transcript', scope).ok).toBe(true);
    expect(authorizeDeveloper('POST', '/api/monitoring/sync/logs', scope).ok).toBe(true);
  });

  it('allows editing config files on assigned bots, denies on others', () => {
    expect(authorizeDeveloper('PUT', '/api/agents/agent-1/config-files/AGENTS.md', scope).ok).toBe(true);
    expect(authorizeDeveloper('PUT', '/api/agents/agent-999/config-files/AGENTS.md', scope).ok).toBe(false);
  });

  it('allows pushing to an assigned node (handler scopes the files), denies others', () => {
    expect(authorizeDeveloper('POST', '/api/machines/m1/sync/push', scope).ok).toBe(true);
    expect(authorizeDeveloper('POST', '/api/machines/m9/sync/push', scope).ok).toBe(false);
    // Other sync operations stay admin-only.
    expect(authorizeDeveloper('POST', '/api/machines/m1/sync/pull', scope).ok).toBe(false);
    expect(authorizeDeveloper('POST', '/api/machines/m1/sync/full', scope).ok).toBe(false);
  });

  it('denies bot mutations and summary generation', () => {
    expect(authorizeDeveloper('POST', '/api/agents/agent-1/provision', scope).ok).toBe(false);
    expect(authorizeDeveloper('DELETE', '/api/agents/agent-1', scope).ok).toBe(false);
    expect(authorizeDeveloper('PATCH', '/api/agents/agent-1', scope).ok).toBe(false);
    expect(authorizeDeveloper('POST', '/api/summaries/generate', scope).ok).toBe(false);
    // A monitoring POST that isn't an allowlisted sync endpoint stays denied.
    expect(authorizeDeveloper('POST', '/api/monitoring/sessions', scope).ok).toBe(false);
  });

  it('allows read-only browse of the global Skills catalog', () => {
    expect(authorizeDeveloper('GET', '/api/skills', scope).ok).toBe(true);
    expect(authorizeDeveloper('GET', '/api/skills/tags', scope).ok).toBe(true);
    expect(authorizeDeveloper('GET', '/api/skills/some-skill-id', scope).ok).toBe(true);
  });

  it('denies all skill mutations (skills are global; read-only for developers)', () => {
    expect(authorizeDeveloper('POST', '/api/skills', scope).ok).toBe(false);
    expect(authorizeDeveloper('PATCH', '/api/skills/some-skill-id', scope).ok).toBe(false);
    expect(authorizeDeveloper('DELETE', '/api/skills/some-skill-id', scope).ok).toBe(false);
    expect(authorizeDeveloper('POST', '/api/skills/some-skill-id/review', scope).ok).toBe(false);
    expect(authorizeDeveloper('POST', '/api/skills/some-skill-id/deploy/m1', scope).ok).toBe(false);
  });

  it('denies admin-only surfaces (node mutations, credentials, users)', () => {
    expect(authorizeDeveloper('POST', '/api/machines', scope).ok).toBe(false);
    expect(authorizeDeveloper('GET', '/api/credentials', scope).ok).toBe(false);
    expect(authorizeDeveloper('GET', '/api/users', scope).ok).toBe(false);
  });
});
