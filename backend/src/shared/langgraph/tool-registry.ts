import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createChildLogger } from '../logger.js';
import type { LangGraphToolDef } from './types.js';

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
      content: { type: 'string', description: 'Content to write' },
    },
    handler: async (args) => {
      const filePath = args.filePath as string;
      const content = args.content as string;
      const resolved = path.resolve(sandboxDir, filePath);
      if (!resolved.startsWith(sandboxDir)) {
        return 'Error: Path traversal not allowed';
      }
      try {
        await fs.mkdir(path.dirname(resolved), { recursive: true });
        await fs.writeFile(resolved, content, 'utf-8');
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

async function tryFetch(url: string): Promise<string> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(15_000),
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; ClawConsole-Playground/1.0)',
      Accept: 'text/html,text/plain,application/json,*/*',
    },
    redirect: 'follow',
  });
  if (!response.ok) {
    return `HTTP ${response.status}: ${response.statusText}`;
  }
  const text = await response.text();
  return text.slice(0, 10_000);
}

export function createWebFetchTool(): LangGraphToolDef {
  return {
    name: 'web_fetch',
    description: 'Fetch the content of a URL and return it as text. Supports HTTP and HTTPS URLs. If no protocol is given, https:// is tried first with http:// fallback.',
    schema: {
      url: { type: 'string', description: 'The URL to fetch (e.g. "https://example.com/api" or "http://wttr.in/London")' },
    },
    handler: async (args) => {
      let url = (args.url as string)?.trim();
      if (!url) return 'Error: url parameter is required';

      // Auto-add protocol if missing
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = `https://${url}`;
      }

      try {
        return await tryFetch(url);
      } catch (firstErr) {
        // If HTTPS failed with timeout/connection error, retry with HTTP
        if (url.startsWith('https://')) {
          const httpUrl = url.replace('https://', 'http://');
          log.info({ httpsUrl: url, httpUrl }, 'HTTPS failed, retrying with HTTP');
          try {
            return await tryFetch(httpUrl);
          } catch {
            // fall through to report the original HTTPS error
          }
        }

        const msg = firstErr instanceof Error ? firstErr.message : String(firstErr);
        if (msg.includes('abort') || msg.includes('timeout')) {
          return `Error: Request to ${url} timed out. The server may be unreachable or slow.`;
        }
        if (msg.includes('ENOTFOUND') || msg.includes('getaddrinfo')) {
          return `Error: DNS resolution failed for ${url}. The hostname could not be resolved.`;
        }
        if (msg.includes('ECONNREFUSED')) {
          return `Error: Connection refused by ${url}. The server is not accepting connections.`;
        }
        log.warn({ url, error: msg }, 'web_fetch failed');
        return `Error fetching ${url}: ${msg}`;
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
 * If allowedTools is empty, all tools are enabled.
 */
export function buildToolSet(sandboxDir: string, allowedTools: string[]): LangGraphToolDef[] {
  const toolNames = allowedTools.length > 0
    ? allowedTools
    : Object.keys(TOOL_FACTORIES);

  const tools: LangGraphToolDef[] = [];
  for (const name of toolNames) {
    const factory = TOOL_FACTORIES[name];
    if (factory) {
      tools.push(factory(sandboxDir));
    } else {
      log.warn({ tool: name }, 'Unknown tool requested, skipping');
    }
  }
  return tools;
}

export function getAvailableToolNames(): string[] {
  return Object.keys(TOOL_FACTORIES);
}
