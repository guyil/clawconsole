import { Stagehand } from '@browserbasehq/stagehand';
import { config } from '../../config/index.js';
import { createChildLogger } from '../logger.js';
import type { LangGraphToolDef } from './types.js';

const log = createChildLogger('browser-tools');

/** Per-session Stagehand instances, lazily initialized on first browser tool call. */
const activeInstances = new Map<string, Stagehand>();

async function getOrCreateStagehand(sessionId: string): Promise<Stagehand> {
  let instance = activeInstances.get(sessionId);
  if (instance) return instance;

  const useBrowserbase = !!config.playground.browserbaseApiKey;
  log.info({ sessionId, useBrowserbase }, 'Initializing Stagehand browser instance');

  // Stagehand's act/extract/observe require an LLM; use Anthropic via our existing key
  const anthropicKey = config.playground.anthropicApiKey;
  const llmConfig = anthropicKey
    ? {
        modelName: 'claude-3-7-sonnet-latest' as const,
        modelClientOptions: { apiKey: anthropicKey },
      }
    : {};

  const stagehandConfig: ConstructorParameters<typeof Stagehand>[0] = useBrowserbase
    ? {
        env: 'BROWSERBASE' as const,
        apiKey: config.playground.browserbaseApiKey,
        projectId: config.playground.browserbaseProjectId,
        enableCaching: true,
        verbose: 0,
        ...llmConfig,
      }
    : {
        env: 'LOCAL' as const,
        enableCaching: true,
        headless: config.playground.browserHeadless,
        verbose: 0,
        ...llmConfig,
      };

  instance = new Stagehand(stagehandConfig);
  await instance.init();
  activeInstances.set(sessionId, instance);
  return instance;
}

/** Clean up a session's browser instance. Call when session ends. */
export async function closeBrowser(sessionId: string): Promise<void> {
  const instance = activeInstances.get(sessionId);
  if (!instance) return;

  try {
    await instance.close();
    log.info({ sessionId }, 'Stagehand browser instance closed');
  } catch (err) {
    log.warn({ err, sessionId }, 'Error closing Stagehand instance');
  }
  activeInstances.delete(sessionId);
}

/** Close all active browser instances (e.g. on server shutdown). */
export async function closeAllBrowsers(): Promise<void> {
  for (const [sessionId] of activeInstances) {
    await closeBrowser(sessionId);
  }
}

/**
 * Creates browser automation tools powered by Stagehand.
 * Each tool lazily initializes a headless Chromium browser on first use.
 */
export function createBrowserTools(sessionId: string): LangGraphToolDef[] {
  return [
    {
      name: 'browser_navigate',
      description: 'Navigate the browser to a URL. Use this to open web pages before performing actions or extracting data.',
      schema: {
        url: { type: 'string', description: 'The full URL to navigate to (e.g. "https://www.google.com")' },
      },
      handler: async (args) => {
        const url = (args.url as string)?.trim();
        if (!url) return 'Error: url is required';
        try {
          const stagehand = await getOrCreateStagehand(sessionId);
          await stagehand.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
          const title = await stagehand.page.title();
          return `Navigated to ${url} — Page title: "${title}"`;
        } catch (err) {
          return `Error navigating to ${url}: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
    {
      name: 'browser_act',
      description: 'Perform an action on the current web page using natural language. Examples: "click the search button", "type hello in the search box", "scroll down", "select the second option from the dropdown".',
      schema: {
        action: { type: 'string', description: 'Natural language description of the action to perform on the page' },
      },
      handler: async (args) => {
        const action = (args.action as string)?.trim();
        if (!action) return 'Error: action is required';
        try {
          const stagehand = await getOrCreateStagehand(sessionId);
          const result = await stagehand.page.act(action);
          return result?.success
            ? `Action completed: ${action}${result.message ? ` — ${result.message}` : ''}`
            : `Action may not have completed: ${action}${result?.message ? ` — ${result.message}` : ''}`;
        } catch (err) {
          return `Error performing action "${action}": ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
    {
      name: 'browser_extract',
      description: 'Extract structured information from the current web page. Describe what data you want to extract in natural language.',
      schema: {
        instruction: { type: 'string', description: 'What information to extract from the page (e.g. "extract all product names and prices")' },
      },
      handler: async (args) => {
        const instruction = (args.instruction as string)?.trim();
        if (!instruction) return 'Error: instruction is required';
        try {
          const stagehand = await getOrCreateStagehand(sessionId);
          const result = await stagehand.page.extract(instruction);
          if (typeof result === 'string') return result;
          if (result && typeof result === 'object' && 'extraction' in result) {
            return (result as { extraction: string }).extraction;
          }
          return JSON.stringify(result, null, 2);
        } catch (err) {
          return `Error extracting data: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
    {
      name: 'browser_observe',
      description: 'Observe the current web page and list available interactive elements and possible actions. Use this to understand what you can do on the page before acting.',
      schema: {
        instruction: { type: 'string', description: 'Optional focus instruction (e.g. "find the login form elements")' },
      },
      handler: async (args) => {
        const instruction = (args.instruction as string) || 'List all interactive elements on the page';
        try {
          const stagehand = await getOrCreateStagehand(sessionId);
          const observations = await stagehand.page.observe(instruction);
          if (!observations || observations.length === 0) {
            return 'No interactive elements found on the current page.';
          }
          return observations
            .slice(0, 30)
            .map((o, i) => `${i + 1}. [${o.selector}] ${o.description}`)
            .join('\n');
        } catch (err) {
          return `Error observing page: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
    {
      name: 'browser_get_text',
      description: 'Get the visible text content of the current web page. Useful for reading page content after navigation.',
      schema: {},
      handler: async () => {
        try {
          const stagehand = await getOrCreateStagehand(sessionId);
          const text = await stagehand.page.innerText('body');
          return text.slice(0, 15_000) || 'Page has no visible text content.';
        } catch (err) {
          return `Error getting page text: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
    {
      name: 'browser_screenshot',
      description: 'Take a screenshot of the current web page and describe what is visible. Returns a text description of the page layout.',
      schema: {},
      handler: async () => {
        try {
          const stagehand = await getOrCreateStagehand(sessionId);
          const title = await stagehand.page.title();
          const url = stagehand.page.url();
          const text = await stagehand.page.innerText('body');
          const truncated = text.slice(0, 3000);
          return `Current page: ${title}\nURL: ${url}\n\nVisible content:\n${truncated}`;
        } catch (err) {
          return `Error capturing page state: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
  ];
}

/** Names of all browser tools for use in tool filtering. */
export const BROWSER_TOOL_NAMES = [
  'browser_navigate',
  'browser_act',
  'browser_extract',
  'browser_observe',
  'browser_get_text',
  'browser_screenshot',
];
