import { ChatAnthropic } from '@langchain/anthropic';
import { StateGraph, MessagesAnnotation } from '@langchain/langgraph';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { LangGraphAgentConfig, LangGraphToolDef, StreamEvent } from './types.js';
import { createChildLogger } from '../logger.js';

const log = createChildLogger('langgraph');

/**
 * Builds a Zod schema from the tool's plain JSON-style schema definition,
 * so the LLM receives proper parameter names and descriptions.
 */
function buildZodSchema(schemaDef: Record<string, unknown>): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [key, value] of Object.entries(schemaDef)) {
    if (typeof value === 'object' && value !== null) {
      const fieldDef = value as { type?: string; description?: string };
      let fieldSchema: z.ZodTypeAny = z.string();
      if (fieldDef.type === 'number') fieldSchema = z.number();
      if (fieldDef.type === 'boolean') fieldSchema = z.boolean();
      if (fieldDef.description) fieldSchema = fieldSchema.describe(fieldDef.description);
      // Optional to avoid strict rejections; handlers validate required fields
      shape[key] = fieldSchema.optional();
    }
  }
  if (Object.keys(shape).length === 0) {
    return z.object({}).passthrough();
  }
  return z.object(shape).passthrough();
}

/**
 * Converts a simplified tool definition into a LangChain tool.
 * This bridge keeps callers decoupled from LangChain's internals.
 */
function toLangChainTool(def: LangGraphToolDef) {
  const zodSchema = def.zodSchema ?? buildZodSchema(def.schema);

  return tool(
    async (args) => {
      try {
        return await def.handler(args as Record<string, unknown>);
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
    {
      name: def.name,
      description: def.description,
      schema: zodSchema,
    },
  );
}

/**
 * Creates a compiled ReAct-style LangGraph agent.
 *
 * The graph alternates between calling the LLM and executing tools
 * until the LLM produces a response without tool calls.
 */
export function buildAgent(config: LangGraphAgentConfig) {
  const langChainTools = config.tools.map(toLangChainTool);

  const model = new ChatAnthropic({
    model: config.model,
    maxTokens: 4096,
  }).bindTools(langChainTools);

  async function agentNode(state: typeof MessagesAnnotation.State) {
    const systemMessage = { role: 'system' as const, content: config.systemPrompt };
    const response = await model.invoke([systemMessage, ...state.messages]);
    return { messages: [response] };
  }

  function shouldContinue(state: typeof MessagesAnnotation.State) {
    const lastMessage = state.messages[state.messages.length - 1];
    if (
      lastMessage &&
      'tool_calls' in lastMessage &&
      Array.isArray(lastMessage.tool_calls) &&
      lastMessage.tool_calls.length > 0
    ) {
      return 'tools';
    }
    return '__end__';
  }

  const toolNode = new ToolNode(langChainTools);

  const graph = new StateGraph(MessagesAnnotation)
    .addNode('agent', agentNode)
    .addNode('tools', toolNode)
    .addEdge('__start__', 'agent')
    .addConditionalEdges('agent', shouldContinue)
    .addEdge('tools', 'agent');

  return graph.compile();
}

/**
 * Runs a compiled agent and yields streaming events.
 * Each yielded event can be serialised as an SSE frame by the caller.
 */
export async function* streamAgent(
  compiledGraph: ReturnType<typeof buildAgent>,
  userMessage: string,
  existingMessages: Array<{ role: string; content: string }> = [],
): AsyncGenerator<StreamEvent> {
  try {
    const inputMessages = [
      ...existingMessages.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: userMessage },
    ];

    const stream = await compiledGraph.stream(
      { messages: inputMessages },
      { streamMode: 'updates' },
    );

    for await (const chunk of stream) {
      if (chunk.agent) {
        const msg = chunk.agent.messages?.[0];
        if (!msg) continue;

        if (msg.tool_calls && msg.tool_calls.length > 0) {
          for (const tc of msg.tool_calls) {
            yield {
              type: 'tool-call-begin',
              data: { id: tc.id, name: tc.name, args: tc.args },
            };
          }
        } else {
          const content = typeof msg.content === 'string'
            ? msg.content
            : JSON.stringify(msg.content);
          yield { type: 'text-delta', data: { content } };
        }
      }

      if (chunk.tools) {
        const msgs = chunk.tools.messages ?? [];
        for (const msg of msgs) {
          yield {
            type: 'tool-call-result',
            data: {
              id: msg.tool_call_id ?? '',
              result: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
            },
          };
        }
      }
    }

    yield { type: 'done', data: {} };
  } catch (err) {
    log.error({ err }, 'Agent stream error');
    yield {
      type: 'error',
      data: { message: err instanceof Error ? err.message : String(err) },
    };
  }
}
