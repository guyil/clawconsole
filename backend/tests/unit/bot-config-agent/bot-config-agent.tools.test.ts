import { describe, it, expect, beforeEach } from 'vitest';
import { buildConfigTools } from '../../../src/modules/bot-config-agent/bot-config-agent.tools.js';
import type { ConfigChatSession } from '../../../src/modules/bot-config-agent/bot-config-agent.types.js';

function createMockSession(files?: Map<string, { filename: string; originalContent: string; currentContent: string; dirty: boolean }>): ConfigChatSession {
  return {
    id: 'session-1',
    agentId: 'agent-1',
    machineId: 'machine-1',
    status: 'active',
    messages: [],
    workspacePath: 'workspace',
    files: files ?? new Map(),
    createdAt: new Date(),
    lastActivityAt: new Date(),
  };
}

function createSessionWithFiles(): ConfigChatSession {
  const files = new Map<string, { filename: string; originalContent: string; currentContent: string; dirty: boolean }>();
  files.set('SOUL.md', {
    filename: 'SOUL.md',
    originalContent: '# Soul\nBe helpful.',
    currentContent: '# Soul\nBe helpful.',
    dirty: false,
  });
  files.set('IDENTITY.md', {
    filename: 'IDENTITY.md',
    originalContent: '# Identity\nName: TestBot',
    currentContent: '# Identity\nName: TestBot',
    dirty: false,
  });
  return createMockSession(files);
}

describe('buildConfigTools', () => {
  let session: ConfigChatSession;

  beforeEach(() => {
    session = createSessionWithFiles();
  });

  it('returns core config + browser tools', () => {
    const tools = buildConfigTools(session);
    expect(tools.length).toBeGreaterThanOrEqual(4);
    const names = tools.map((t) => t.name);
    expect(names).toContain('read_config_file');
    expect(names).toContain('write_config_file');
    expect(names).toContain('list_config_files');
    expect(names).toContain('get_agent_info');
  });

  describe('read_config_file', () => {
    it('reads existing file content', async () => {
      const tools = buildConfigTools(session);
      const readTool = tools.find((t) => t.name === 'read_config_file')!;
      const result = await readTool.handler({ filename: 'SOUL.md' });
      expect(result).toBe('# Soul\nBe helpful.');
    });

    it('returns error for non-existent file', async () => {
      const tools = buildConfigTools(session);
      const readTool = tools.find((t) => t.name === 'read_config_file')!;
      const result = await readTool.handler({ filename: 'NONEXISTENT.md' });
      expect(result).toContain('Error');
      expect(result).toContain('not found');
    });

    it('lists available files in error message', async () => {
      const tools = buildConfigTools(session);
      const readTool = tools.find((t) => t.name === 'read_config_file')!;
      const result = await readTool.handler({ filename: 'NONEXISTENT.md' });
      expect(result).toContain('SOUL.md');
      expect(result).toContain('IDENTITY.md');
    });
  });

  describe('write_config_file', () => {
    it('updates existing file and marks as dirty', async () => {
      const tools = buildConfigTools(session);
      const writeTool = tools.find((t) => t.name === 'write_config_file')!;

      const result = await writeTool.handler({ filename: 'SOUL.md', content: '# Soul\nBe very friendly.' });
      expect(result).toContain('Successfully updated');
      expect(result).toContain('SOUL.md');

      const snapshot = session.files.get('SOUL.md')!;
      expect(snapshot.currentContent).toBe('# Soul\nBe very friendly.');
      expect(snapshot.dirty).toBe(true);
      expect(snapshot.originalContent).toBe('# Soul\nBe helpful.');
    });

    it('creates new file if it does not exist', async () => {
      const tools = buildConfigTools(session);
      const writeTool = tools.find((t) => t.name === 'write_config_file')!;

      const result = await writeTool.handler({ filename: 'USER.md', content: '# User\nVictor' });
      expect(result).toContain('Successfully updated');

      const snapshot = session.files.get('USER.md')!;
      expect(snapshot.currentContent).toBe('# User\nVictor');
      expect(snapshot.dirty).toBe(true);
      expect(snapshot.originalContent).toBe('');
    });

    it('rejects invalid filenames', async () => {
      const tools = buildConfigTools(session);
      const writeTool = tools.find((t) => t.name === 'write_config_file')!;

      const result = await writeTool.handler({ filename: 'INVALID.md', content: 'test' });
      expect(result).toContain('Error');
      expect(result).toContain('not a valid config file');
    });

    it('marks file as not dirty when content matches original', async () => {
      const tools = buildConfigTools(session);
      const writeTool = tools.find((t) => t.name === 'write_config_file')!;

      // First change it
      await writeTool.handler({ filename: 'SOUL.md', content: '# Soul\nBe very friendly.' });
      expect(session.files.get('SOUL.md')!.dirty).toBe(true);

      // Then change it back to original
      await writeTool.handler({ filename: 'SOUL.md', content: '# Soul\nBe helpful.' });
      expect(session.files.get('SOUL.md')!.dirty).toBe(false);
    });
  });

  describe('list_config_files', () => {
    it('lists all files with status', async () => {
      const tools = buildConfigTools(session);
      const listTool = tools.find((t) => t.name === 'list_config_files')!;

      const result = await listTool.handler({});
      expect(result).toContain('[unchanged] SOUL.md');
      expect(result).toContain('[unchanged] IDENTITY.md');
    });

    it('shows modified status for dirty files', async () => {
      session.files.get('SOUL.md')!.dirty = true;

      const tools = buildConfigTools(session);
      const listTool = tools.find((t) => t.name === 'list_config_files')!;

      const result = await listTool.handler({});
      expect(result).toContain('[modified] SOUL.md');
      expect(result).toContain('[unchanged] IDENTITY.md');
    });

    it('handles empty session', async () => {
      const emptySession = createMockSession(new Map());
      const tools = buildConfigTools(emptySession);
      const listTool = tools.find((t) => t.name === 'list_config_files')!;

      const result = await listTool.handler({});
      expect(result).toContain('No config files found');
    });
  });

  describe('get_agent_info', () => {
    it('returns agent metadata as JSON', async () => {
      const tools = buildConfigTools(session);
      const infoTool = tools.find((t) => t.name === 'get_agent_info')!;

      const result = await infoTool.handler({});
      const parsed = JSON.parse(result);
      expect(parsed.agentId).toBe('agent-1');
      expect(parsed.machineId).toBe('machine-1');
      expect(parsed.workspacePath).toBe('workspace');
      expect(parsed.filesLoaded).toContain('SOUL.md');
      expect(parsed.filesLoaded).toContain('IDENTITY.md');
    });
  });
});
