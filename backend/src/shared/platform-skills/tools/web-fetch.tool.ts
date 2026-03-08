import type { LangGraphToolDef } from '../../langgraph/types.js';
import { createChildLogger } from '../../logger.js';

const log = createChildLogger('web-fetch');

async function tryFetch(url: string): Promise<string> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(15_000),
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; ClawConsole/1.0)',
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

/**
 * Shared web_fetch tool used by all platform agents.
 * Tries HTTPS first, falls back to HTTP on connection errors.
 */
export function createWebFetchTool(): LangGraphToolDef {
  return {
    name: 'web_fetch',
    description:
      'Fetch the content of a URL and return it as text. Supports HTTP and HTTPS URLs. ' +
      'If no protocol is given, https:// is tried first with http:// fallback.',
    schema: {
      url: {
        type: 'string',
        description: 'The URL to fetch (e.g. "https://example.com/api" or "http://wttr.in/London")',
      },
    },
    handler: async (args) => {
      let url = (args.url as string)?.trim();
      if (!url) return 'Error: url parameter is required';

      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = `https://${url}`;
      }

      try {
        return await tryFetch(url);
      } catch (firstErr) {
        if (url.startsWith('https://')) {
          const httpUrl = url.replace('https://', 'http://');
          log.info({ httpsUrl: url, httpUrl }, 'HTTPS failed, retrying with HTTP');
          try {
            return await tryFetch(httpUrl);
          } catch {
            // fall through to report original error
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
