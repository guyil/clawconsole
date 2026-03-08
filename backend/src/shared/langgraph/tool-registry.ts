import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createChildLogger } from '../logger.js';
import type { LangGraphToolDef } from './types.js';
import { createBrowserTools, BROWSER_TOOL_NAMES } from './browser-tools.js';
import { createWebFetchTool } from '../platform-skills/tools/web-fetch.tool.js';

const log = createChildLogger('tool-registry');

/**
 * Pre-built sandbox tools that can be selectively enabled per session.
 * Each tool operates within a restricted `sandboxDir`.
 */

export function createReadFileTool(sandboxDir: string): LangGraphToolDef {
  return {
    name: 'read_file',
    description: 'Read the contents of a file within the sandbox directory.',
    schema: { filePath: { type: 'string', description: 'Relative path to the file' } },
    handler: async (args) => {
      const filePath = args.filePath as string;
      const resolved = path.resolve(sandboxDir, filePath);
      if (!resolved.startsWith(sandboxDir)) {
        return 'Error: Path traversal not allowed';
      }
      try {
        return await fs.readFile(resolved, 'utf-8');
      } catch (err) {
        return `Error reading file: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  };
}

export function createWriteFileTool(sandboxDir: string): LangGraphToolDef {
  return {
    name: 'write_file',
    description: 'Write content to a file within the sandbox directory.',
    schema: {
      filePath: { type: 'string', description: 'Relative path to the file' },
      fileContent: { type: 'string', description: 'The text content to write to the file' },
    },
    handler: async (args) => {
      const filePath = args.filePath as string;
      const fileContent = (args.fileContent ?? args.content) as string;
      if (!filePath) return 'Error: filePath is required';
      if (!fileContent) return 'Error: fileContent is required';
      const resolved = path.resolve(sandboxDir, filePath);
      if (!resolved.startsWith(sandboxDir)) {
        return 'Error: Path traversal not allowed';
      }
      try {
        await fs.mkdir(path.dirname(resolved), { recursive: true });
        await fs.writeFile(resolved, fileContent, 'utf-8');
        return `File written: ${filePath}`;
      } catch (err) {
        return `Error writing file: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  };
}

export function createListFilesTool(sandboxDir: string): LangGraphToolDef {
  return {
    name: 'list_files',
    description: 'List files and directories within the sandbox directory.',
    schema: {
      dirPath: { type: 'string', description: 'Relative path to the directory (default: root)' },
    },
    handler: async (args) => {
      const dirPath = (args.dirPath as string) || '.';
      const resolved = path.resolve(sandboxDir, dirPath);
      if (!resolved.startsWith(sandboxDir)) {
        return 'Error: Path traversal not allowed';
      }
      try {
        const entries = await fs.readdir(resolved, { withFileTypes: true });
        return entries
          .map((e) => `${e.isDirectory() ? '[dir]' : '[file]'} ${e.name}`)
          .join('\n');
      } catch (err) {
        return `Error listing files: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  };
}

export function createSearchTool(sandboxDir: string): LangGraphToolDef {
  return {
    name: 'search',
    description: 'Search for a text pattern in files within the sandbox directory.',
    schema: {
      pattern: { type: 'string', description: 'Text pattern to search for' },
      fileGlob: { type: 'string', description: 'File glob pattern (e.g. "*.ts")' },
    },
    handler: async (args) => {
      const pattern = args.pattern as string;
      const { execSync } = await import('node:child_process');
      try {
        const result = execSync(
          `grep -rn --include="${args.fileGlob || '*'}" "${pattern.replace(/"/g, '\\"')}" .`,
          { cwd: sandboxDir, timeout: 10_000, encoding: 'utf-8', maxBuffer: 1024 * 256 },
        );
        const lines = result.split('\n').slice(0, 50);
        return lines.join('\n') || 'No matches found';
      } catch {
        return 'No matches found';
      }
    },
  };
}

/** All available sandbox tool factories, keyed by tool name. */
const TOOL_FACTORIES: Record<string, (sandboxDir: string) => LangGraphToolDef> = {
  read_file: createReadFileTool,
  write_file: createWriteFileTool,
  list_files: createListFilesTool,
  search: createSearchTool,
  web_fetch: () => createWebFetchTool(),
};

/**
 * Builds the set of tools for a playground session based on the allowed list.
 * If allowedTools is empty, all tools (including browser tools) are enabled.
 * Pass a sessionId to enable browser tools with per-session lifecycle.
 */
export function buildToolSet(
  sandboxDir: string,
  allowedTools: string[],
  sessionId?: string,
): LangGraphToolDef[] {
  const allFactoryNames = Object.keys(TOOL_FACTORIES);
  const allNames = [...allFactoryNames, ...BROWSER_TOOL_NAMES];

  const toolNames = allowedTools.length > 0
    ? allowedTools
    : allNames;

  const tools: LangGraphToolDef[] = [];

  // Browser tools (need sessionId for lifecycle management)
  const wantsBrowser = toolNames.some((n) => BROWSER_TOOL_NAMES.includes(n));
  const browserTools = wantsBrowser && sessionId
    ? createBrowserTools(sessionId)
    : [];
  const browserMap = new Map(browserTools.map((t) => [t.name, t]));

  for (const name of toolNames) {
    // Check browser tools first
    const bt = browserMap.get(name);
    if (bt) {
      tools.push(bt);
      continue;
    }
    // Then sandbox tools
    const factory = TOOL_FACTORIES[name];
    if (factory) {
      tools.push(factory(sandboxDir));
    } else if (!BROWSER_TOOL_NAMES.includes(name)) {
      log.warn({ tool: name }, 'Unknown tool requested, skipping');
    }
  }
  return tools;
}

export function getAvailableToolNames(): string[] {
  return [...Object.keys(TOOL_FACTORIES), ...BROWSER_TOOL_NAMES];
}

export { closeBrowser } from './browser-tools.js';
