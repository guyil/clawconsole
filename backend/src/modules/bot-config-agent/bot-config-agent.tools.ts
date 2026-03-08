import type { LangGraphToolDef } from '../../shared/langgraph/types.js';
import { createBrowserTools } from '../../shared/langgraph/browser-tools.js';
import type { ConfigChatSession } from './bot-config-agent.types.js';

const CONFIG_FILES = [
  'SOUL.md',
  'IDENTITY.md',
  'USER.md',
  'AGENTS.md',
  'TOOLS.md',
  'BOOTSTRAP.md',
  'HEARTBEAT.md',
  'README.md',
];

/**
 * Creates tools that let the LLM read/write bot config files
 * stored in the in-memory session snapshot.
 */
export function buildConfigTools(session: ConfigChatSession): LangGraphToolDef[] {
  return [
    createReadConfigFileTool(session),
    createWriteConfigFileTool(session),
    createListConfigFilesTool(session),
    createGetAgentInfoTool(session),
    ...createBrowserTools(`bot-config-${session.id}`),
  ];
}

function createReadConfigFileTool(session: ConfigChatSession): LangGraphToolDef {
  return {
    name: 'read_config_file',
    description:
      'Read the current content of a bot configuration file (e.g. SOUL.md, IDENTITY.md). ' +
      'Returns the full markdown content.',
    schema: {
      filename: {
        type: 'string',
        description: `Filename to read. One of: ${CONFIG_FILES.join(', ')}`,
      },
    },
    handler: async (args) => {
      const filename = args.filename as string;
      const snapshot = session.files.get(filename);
      if (!snapshot) {
        const available = [...session.files.keys()].join(', ');
        return `Error: File "${filename}" not found. Available files: ${available || 'none'}`;
      }
      return snapshot.currentContent;
    },
  };
}

function createWriteConfigFileTool(session: ConfigChatSession): LangGraphToolDef {
  return {
    name: 'write_config_file',
    description:
      'Write new content to a bot configuration file. This updates the local draft; ' +
      'the user must click "Sync" to push changes to the remote machine. ' +
      'Always read the file first, understand the existing structure, then write the full updated content.',
    schema: {
      filename: {
        type: 'string',
        description: `Filename to write. One of: ${CONFIG_FILES.join(', ')}`,
      },
      content: {
        type: 'string',
        description: 'The full new markdown content for the file',
      },
    },
    handler: async (args) => {
      const filename = args.filename as string;
      const content = args.content as string;

      if (!CONFIG_FILES.includes(filename)) {
        return `Error: "${filename}" is not a valid config file. Valid files: ${CONFIG_FILES.join(', ')}`;
      }

      const existing = session.files.get(filename);
      if (existing) {
        existing.currentContent = content;
        existing.dirty = existing.currentContent !== existing.originalContent;
      } else {
        session.files.set(filename, {
          filename,
          originalContent: '',
          currentContent: content,
          dirty: true,
        });
      }

      return `Successfully updated ${filename} (${content.length} chars). The change is staged locally — the user needs to click "Sync" to push it to the machine.`;
    },
  };
}

function createListConfigFilesTool(session: ConfigChatSession): LangGraphToolDef {
  return {
    name: 'list_config_files',
    description:
      'List all available bot configuration files and their status (modified or not).',
    schema: {},
    handler: async () => {
      if (session.files.size === 0) {
        return 'No config files found for this bot.';
      }
      const lines: string[] = [];
      for (const [filename, snap] of session.files) {
        const status = snap.dirty ? '[modified]' : '[unchanged]';
        const size = `${snap.currentContent.length} chars`;
        lines.push(`${status} ${filename} (${size})`);
      }
      return lines.join('\n');
    },
  };
}

function createGetAgentInfoTool(session: ConfigChatSession): LangGraphToolDef {
  return {
    name: 'get_agent_info',
    description: 'Get metadata about the current bot/agent (ID, name, workspace, machine).',
    schema: {},
    handler: async () => {
      return JSON.stringify({
        agentId: session.agentId,
        machineId: session.machineId,
        workspacePath: session.workspacePath,
        sessionId: session.id,
        filesLoaded: [...session.files.keys()],
      });
    },
  };
}
