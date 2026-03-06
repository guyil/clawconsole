import { v4 as uuidv4 } from 'uuid';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { AppError, NotFoundError } from '../../shared/errors.js';
import { buildAgent, streamAgent, buildToolSet } from '../../shared/langgraph/index.js';
import type { StreamEvent, LangGraphToolDef } from '../../shared/langgraph/types.js';
import { createChildLogger } from '../../shared/logger.js';
import { PlaygroundRepository } from './playground.repository.js';
import { parseSkillMd, validateSkillMd, scanSkillSecurity } from './playground.validator.js';
import type {
  PlaygroundSession,
  PlaygroundSessionConfig,
  CreatePlaygroundSessionInput,
  PlaygroundMessage,
  ToolCallLogEntry,
  CreateSkillVersionInput,
  SkillVersion,
  ValidateSkillResult,
  SecurityScanResult,
  ParsedSkill,
  BotIdentityFile,
  SkillFileMap,
  SkillFile,
} from './playground.types.js';

const log = createChildLogger('playground-service');

const DEFAULT_CONFIG: PlaygroundSessionConfig = {
  model: 'claude-sonnet-4-20250514',
  maxToolCalls: 50,
  timeoutSeconds: 300,
  allowedTools: [],
};

/** Tracks running sandbox directories so we can clean up on session end. */
const activeSandboxes = new Map<string, string>();

export class PlaygroundService {
  constructor(private readonly repo: PlaygroundRepository) {}

  // --- Session CRUD ---

  async createSession(input: CreatePlaygroundSessionInput): Promise<PlaygroundSession> {
    const validation = validateSkillMd(input.skillMdContent);
    if (!validation.valid) {
      throw new AppError('Invalid skill content', 'VALIDATION_ERROR', 400, {
        errors: validation.errors,
      });
    }

    const mergedConfig: PlaygroundSessionConfig = {
      ...DEFAULT_CONFIG,
      ...input.config,
    };

    // If the skill's frontmatter specifies allowed-tools, use those
    if (validation.parsed?.frontmatter['allowed-tools'] && mergedConfig.allowedTools.length === 0) {
      mergedConfig.allowedTools = validation.parsed.frontmatter['allowed-tools']
        .split(',')
        .map((t: string) => t.trim().toLowerCase())
        .filter(Boolean);
    }

    const session = await this.repo.createSession(
      input.skillCatalogId ?? null,
      input.skillMdContent,
      mergedConfig,
      input.agentId ?? null,
      input.identityFiles ?? null,
    );

    // Run a security scan and attach it
    const scanResult = scanSkillSecurity(input.skillMdContent);
    await this.repo.setSecurityScanResult(session.id, scanResult);

    return (await this.repo.findSessionById(session.id))!;
  }

  async getSession(id: string): Promise<PlaygroundSession> {
    const session = await this.repo.findSessionById(id);
    if (!session) throw new NotFoundError('PlaygroundSession', id);
    return session;
  }

  async listSessions(filters?: { status?: string; skillCatalogId?: string }): Promise<PlaygroundSession[]> {
    return this.repo.listSessions(filters as any);
  }

  async deleteSession(id: string): Promise<void> {
    await this.cleanupSandbox(id);
    const deleted = await this.repo.deleteSession(id);
    if (!deleted) throw new NotFoundError('PlaygroundSession', id);
  }

  // --- Chat ---

  async *chat(sessionId: string, userMessage: string): AsyncGenerator<StreamEvent> {
    const session = await this.getSession(sessionId);
    if (session.status !== 'active') {
      throw new AppError('Session is not active', 'SESSION_NOT_ACTIVE', 400);
    }

    // Persist user message
    const userMsg: PlaygroundMessage = {
      id: uuidv4(),
      role: 'user',
      content: userMessage,
      timestamp: new Date().toISOString(),
    };
    await this.repo.appendMessage(sessionId, userMsg);

    // Create sandbox directory
    const sandboxDir = await this.ensureSandbox(sessionId);

    // Build tools first so we can list them in the prompt
    const tools = buildToolSet(sandboxDir, session.config.allowedTools);

    // Parse skill and build prompt with identity context + available tools
    const parsed = parseSkillMd(session.skillSnapshot);
    const systemPrompt = this.buildSystemPrompt(parsed, session.identitySnapshot, tools);
    const agent = buildAgent({
      model: session.config.model,
      systemPrompt,
      tools,
      maxToolCalls: session.config.maxToolCalls,
      timeoutMs: session.config.timeoutSeconds * 1000,
    });

    // Convert existing messages for context
    const existingMessages = session.messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    let assistantContent = '';
    const toolCallEntries: ToolCallLogEntry[] = [];
    const toolCallStarts = new Map<string, number>();
    let toolCallCount = 0;

    try {
      for await (const event of streamAgent(agent, userMessage, existingMessages)) {
        yield event;

        if (event.type === 'text-delta') {
          assistantContent += event.data.content as string;
        }

        if (event.type === 'tool-call-begin') {
          toolCallCount++;
          if (toolCallCount > session.config.maxToolCalls) {
            yield { type: 'error', data: { message: 'Max tool calls exceeded' } };
            await this.repo.updateSessionStatus(sessionId, 'error', {
              reason: 'max_tool_calls_exceeded',
            });
            break;
          }
          toolCallStarts.set(event.data.id as string, Date.now());
        }

        if (event.type === 'tool-call-result') {
          const callId = event.data.id as string;
          const startTime = toolCallStarts.get(callId) ?? Date.now();
          const entry: ToolCallLogEntry = {
            id: callId,
            toolName: event.data.name as string ?? 'unknown',
            args: {},
            result: event.data.result as string,
            durationMs: Date.now() - startTime,
            timestamp: new Date().toISOString(),
          };
          toolCallEntries.push(entry);
          await this.repo.appendToolCallLog(sessionId, entry);
        }

        if (event.type === 'done') {
          // Persist assistant message
          if (assistantContent) {
            const assistantMsg: PlaygroundMessage = {
              id: uuidv4(),
              role: 'assistant',
              content: assistantContent,
              timestamp: new Date().toISOString(),
            };
            await this.repo.appendMessage(sessionId, assistantMsg);
          }
        }

        if (event.type === 'error') {
          await this.repo.updateSessionStatus(sessionId, 'error', {
            message: event.data.message,
          });
        }
      }
    } catch (err) {
      log.error({ err, sessionId }, 'Chat stream error');
      await this.repo.updateSessionStatus(sessionId, 'error', {
        message: err instanceof Error ? err.message : String(err),
      });
      yield { type: 'error', data: { message: err instanceof Error ? err.message : String(err) } };
    }
  }

  async stopSession(sessionId: string): Promise<void> {
    await this.repo.updateSessionStatus(sessionId, 'completed');
    await this.cleanupSandbox(sessionId);
  }

  // --- Skill Files ---

  async getSkillFiles(sessionId: string): Promise<SkillFile[]> {
    const session = await this.getSession(sessionId);
    return Object.entries(session.skillFiles).map(([path, content]) => ({ path, content }));
  }

  async getSkillFile(sessionId: string, filePath: string): Promise<SkillFile> {
    const session = await this.getSession(sessionId);
    const content = session.skillFiles[filePath];
    if (content === undefined) throw new NotFoundError('SkillFile', filePath);
    return { path: filePath, content };
  }

  async updateSkillFile(sessionId: string, filePath: string, content: string): Promise<SkillFile> {
    await this.getSession(sessionId);
    await this.repo.updateSkillFile(sessionId, filePath, content);
    return { path: filePath, content };
  }

  async deleteSkillFile(sessionId: string, filePath: string): Promise<void> {
    if (filePath === 'SKILL.md') throw new AppError('Cannot delete SKILL.md', 'VALIDATION_ERROR', 400);
    await this.getSession(sessionId);
    await this.repo.deleteSkillFile(sessionId, filePath);
  }

  // --- Optimizer Chat ---

  async *optimizerChat(sessionId: string, userMessage: string): AsyncGenerator<StreamEvent> {
    const session = await this.getSession(sessionId);
    if (session.status !== 'active') {
      throw new AppError('Session is not active', 'SESSION_NOT_ACTIVE', 400);
    }

    const userMsg: PlaygroundMessage = {
      id: uuidv4(),
      role: 'user',
      content: userMessage,
      timestamp: new Date().toISOString(),
    };
    await this.repo.appendOptimizerMessage(sessionId, userMsg);

    const optimizerTools = this.buildOptimizerTools(sessionId);
    const systemPrompt = this.buildOptimizerSystemPrompt(session.skillFiles);

    const agent = buildAgent({
      model: session.config.model,
      systemPrompt,
      tools: optimizerTools,
      maxToolCalls: session.config.maxToolCalls,
      timeoutMs: session.config.timeoutSeconds * 1000,
    });

    const existingMessages = session.optimizerMessages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    let assistantContent = '';

    try {
      for await (const event of streamAgent(agent, userMessage, existingMessages)) {
        yield event;

        if (event.type === 'text-delta') {
          assistantContent += event.data.content as string;
        }

        if (event.type === 'done' && assistantContent) {
          const assistantMsg: PlaygroundMessage = {
            id: uuidv4(),
            role: 'assistant',
            content: assistantContent,
            timestamp: new Date().toISOString(),
          };
          await this.repo.appendOptimizerMessage(sessionId, assistantMsg);
        }

        if (event.type === 'error') {
          log.error({ sessionId, error: event.data.message }, 'Optimizer stream error');
        }
      }
    } catch (err) {
      log.error({ err, sessionId }, 'Optimizer chat stream error');
      yield { type: 'error', data: { message: err instanceof Error ? err.message : String(err) } };
    }
  }

  // --- Validation & Security ---

  validate(skillMdContent: string): ValidateSkillResult {
    return validateSkillMd(skillMdContent);
  }

  securityScan(skillMdContent: string): SecurityScanResult {
    return scanSkillSecurity(skillMdContent);
  }

  parse(skillMdContent: string): ParsedSkill | null {
    return parseSkillMd(skillMdContent);
  }

  // --- Skill Versions ---

  async listVersions(skillCatalogId: string): Promise<SkillVersion[]> {
    return this.repo.listVersions(skillCatalogId);
  }

  async createVersion(skillCatalogId: string, input: CreateSkillVersionInput): Promise<SkillVersion> {
    const existing = await this.repo.findVersionByNumber(skillCatalogId, input.version);
    if (existing) {
      throw new AppError(`Version ${input.version} already exists`, 'CONFLICT', 409);
    }
    return this.repo.createVersion(skillCatalogId, input);
  }

  async getVersion(versionId: string): Promise<SkillVersion> {
    const version = await this.repo.findVersionById(versionId);
    if (!version) throw new NotFoundError('SkillVersion', versionId);
    return version;
  }

  // --- Templates ---

  getTemplates(): Array<{ id: string; name: string; description: string; content: string }> {
    return SKILL_TEMPLATES;
  }

  // --- Helpers ---

  /**
   * Identity-first prompt strategy:
   * 1. Bot identity files (SOUL.md, IDENTITY.md, USER.md) define who the agent is
   * 2. Skill instructions define what the agent can do in this session
   * 3. Available tools tell the agent what it can actually call
   */
  private buildSystemPrompt(
    parsed: ParsedSkill | null,
    identityFiles?: BotIdentityFile[] | null,
    availableTools?: LangGraphToolDef[],
  ): string {
    const parts: string[] = [];

    // Layer 1: Bot identity (if a bot is selected)
    if (identityFiles && identityFiles.length > 0) {
      parts.push('# Your Identity\n');
      const sortOrder: Record<string, number> = { 'SOUL.md': 0, 'IDENTITY.md': 1, 'USER.md': 2 };
      const sorted = [...identityFiles].sort(
        (a, b) => (sortOrder[a.filename] ?? 10) - (sortOrder[b.filename] ?? 10),
      );
      for (const file of sorted) {
        parts.push(`## ${file.filename}\n${file.content}\n`);
      }
    } else {
      parts.push('You are a helpful AI assistant in the OpenClaw Playground.\n');
    }

    // Layer 2: Available tools — critical for the agent to know what it can actually do
    if (availableTools && availableTools.length > 0) {
      parts.push('# Available Tools\n');
      parts.push('You can ONLY use the following tools. Do NOT attempt to call any other tools.\n');
      for (const t of availableTools) {
        const params = Object.keys(t.schema).join(', ');
        parts.push(`- **${t.name}**${params ? ` (${params})` : ''}: ${t.description}`);
      }
      parts.push('');
    }

    // Layer 3: Skill instructions
    parts.push('# Active Skill\n');
    parts.push('Follow the skill instructions below. Adapt the instructions to work with your available tools listed above.\n');
    parts.push('If the skill references tools or commands you do not have, use your available tools to accomplish the same goal.\n');

    if (parsed?.frontmatter.description) {
      parts.push(`## Skill Description\n${parsed.frontmatter.description}\n`);
    }

    if (parsed?.content) {
      parts.push(`## Skill Instructions\n${parsed.content}`);
    }

    return parts.join('\n');
  }

  /**
   * Builds tools that let the optimizer AI read, write, list, and create
   * files in the session's virtual skill directory.
   */
  private buildOptimizerTools(sessionId: string): LangGraphToolDef[] {
    return [
      {
        name: 'read_skill_file',
        description: 'Read a file from the skill directory. Use this to examine current SKILL.md or auxiliary files.',
        schema: { filePath: { type: 'string', description: 'Relative path (e.g. "SKILL.md", "reference.md", "scripts/helper.py")' } },
        handler: async (args) => {
          try {
            const file = await this.getSkillFile(sessionId, args.filePath as string);
            return file.content;
          } catch {
            return `File not found: ${args.filePath}`;
          }
        },
      },
      {
        name: 'write_skill_file',
        description: 'Create or overwrite a file in the skill directory. Changes are reflected in the editor immediately.',
        schema: {
          filePath: { type: 'string', description: 'Relative path (e.g. "SKILL.md", "reference.md", "scripts/helper.py")' },
          fileContent: { type: 'string', description: 'The full file content to write' },
        },
        handler: async (args) => {
          const filePath = args.filePath as string;
          const fileContent = (args.fileContent ?? args.content) as string;
          if (!filePath) return 'Error: filePath is required';
          if (!fileContent) return 'Error: fileContent is required';
          await this.updateSkillFile(sessionId, filePath, fileContent);
          return `Written: ${filePath}`;
        },
      },
      {
        name: 'list_skill_files',
        description: 'List all files in the skill directory.',
        schema: {},
        handler: async () => {
          const files = await this.getSkillFiles(sessionId);
          if (files.length === 0) return 'No files in skill directory';
          return files.map((f) => `${f.path} (${f.content.length} chars)`).join('\n');
        },
      },
      {
        name: 'delete_skill_file',
        description: 'Delete a file from the skill directory (cannot delete SKILL.md).',
        schema: { filePath: { type: 'string', description: 'Relative path of the file to delete' } },
        handler: async (args) => {
          try {
            await this.deleteSkillFile(sessionId, args.filePath as string);
            return `Deleted: ${args.filePath}`;
          } catch (err) {
            return `Error: ${err instanceof Error ? err.message : String(err)}`;
          }
        },
      },
    ];
  }

  private buildOptimizerSystemPrompt(skillFiles: SkillFileMap): string {
    const parts: string[] = [];
    parts.push(`You are a **Skill Optimizer AI** — an expert at designing, improving, and debugging Claude Code skills (SKILL.md format).

Your job is to help the user create high-quality, well-structured skills. You have tools to read and write files in the skill directory.

## Skill Format (SKILL.md)

A skill uses YAML frontmatter followed by markdown instructions:
\`\`\`
---
name: skill-name
description: What this skill does and when to use it
allowed-tools: tool1,tool2
---

Instructions for the AI agent when this skill is active...
\`\`\`

### Frontmatter Fields
- \`name\` (required): kebab-case identifier
- \`description\` (required): when/how to invoke this skill
- \`allowed-tools\`: comma-separated tool whitelist
- \`disable-model-invocation\`: prevent sub-model calls
- \`user-invocable\`: whether users can directly trigger this skill
- \`context\`: additional context files
- \`model\`: preferred model override
- \`argument-hint\`: hint for argument parsing

## Skill Directory Structure

A skill can be a single SKILL.md or a directory:
\`\`\`
my-skill/
├── SKILL.md           # Main instructions (required)
├── reference.md       # Detailed reference documentation
├── examples/
│   └── sample.md      # Example inputs/outputs
└── scripts/
    └── helper.py      # Utility scripts
\`\`\`

## Current Skill Files
`);

    for (const [filePath, content] of Object.entries(skillFiles)) {
      parts.push(`### ${filePath}\n\`\`\`\n${content}\n\`\`\``);
    }

    parts.push(`
## Guidelines

1. **Be specific** — vague instructions produce inconsistent results
2. **Use numbered steps** — sequential instructions are clearer
3. **Define constraints** — state what the skill should NOT do
4. **Add examples** — reference.md / examples/ help the agent understand expected behavior
5. **Security** — avoid shell injection, eval, or dynamic code execution patterns
6. **Iterate** — read the current files, suggest improvements, and apply them directly

When making changes, always use \`write_skill_file\` to apply them directly. Explain your reasoning before writing.`);

    return parts.join('\n');
  }

  private async ensureSandbox(sessionId: string): Promise<string> {
    let sandboxDir = activeSandboxes.get(sessionId);
    if (sandboxDir) return sandboxDir;

    sandboxDir = path.join(os.tmpdir(), `playground-${sessionId}`);
    await fs.mkdir(sandboxDir, { recursive: true });
    activeSandboxes.set(sessionId, sandboxDir);
    return sandboxDir;
  }

  private async cleanupSandbox(sessionId: string): Promise<void> {
    const sandboxDir = activeSandboxes.get(sessionId);
    if (!sandboxDir) return;

    try {
      await fs.rm(sandboxDir, { recursive: true, force: true });
    } catch (err) {
      log.warn({ err, sessionId }, 'Failed to clean up sandbox directory');
    }
    activeSandboxes.delete(sessionId);
  }
}

const SKILL_TEMPLATES = [
  {
    id: 'basic',
    name: 'Basic Skill',
    description: 'A simple skill template with minimal configuration',
    content: `---
name: my-skill
description: A helpful skill that assists with a specific task
---

When helping the user:

1. Understand the request clearly
2. Break down the task into steps
3. Execute each step carefully
4. Summarize the results
`,
  },
  {
    id: 'code-review',
    name: 'Code Review',
    description: 'A skill for reviewing code quality and suggesting improvements',
    content: `---
name: code-review
description: Reviews code for quality, bugs, and improvements. Use when the user asks for a code review or wants feedback on their code.
allowed-tools: read_file,list_files,search
---

When reviewing code:

1. **Read the file** using the read_file tool
2. **Analyze** for:
   - Code style and consistency
   - Potential bugs or edge cases
   - Performance considerations
   - Security vulnerabilities
3. **Suggest improvements** with concrete examples
4. **Rate** overall quality on a scale of 1-10

Format your review with clear sections using markdown headings.
`,
  },
  {
    id: 'data-analysis',
    name: 'Data Analysis',
    description: 'A skill for analyzing data files and generating insights',
    content: `---
name: data-analysis
description: Analyzes data files to generate insights, patterns, and summaries. Use when the user provides data or asks for data analysis.
allowed-tools: read_file,write_file,list_files
---

When analyzing data:

1. **Load the data** from the provided file
2. **Identify** the data structure and types
3. **Analyze** for:
   - Key statistics (min, max, mean, median)
   - Patterns and trends
   - Outliers and anomalies
4. **Generate a summary report** with:
   - Overview of findings
   - Key metrics
   - Recommendations
5. **Save the report** as a markdown file
`,
  },
  {
    id: 'api-helper',
    name: 'API Helper',
    description: 'A skill for working with REST APIs',
    content: `---
name: api-helper
description: Helps design, test, and document REST APIs. Use when the user needs help with API endpoints, requests, or documentation.
allowed-tools: web_fetch,write_file
---

When helping with APIs:

1. **Understand the requirements** — what endpoints, methods, and data
2. **Design the API** following REST best practices:
   - Use proper HTTP methods (GET, POST, PUT, DELETE)
   - Return appropriate status codes
   - Use consistent naming conventions
3. **Test endpoints** using the web_fetch tool when URLs are provided
4. **Document** the API with:
   - Endpoint paths and methods
   - Request/response examples
   - Error handling
`,
  },
  {
    id: 'devops',
    name: 'DevOps Assistant',
    description: 'A skill for infrastructure and deployment tasks',
    content: `---
name: devops-assistant
description: Assists with DevOps tasks including CI/CD, Docker, and infrastructure configuration. Use when the user needs help with deployment or infrastructure.
allowed-tools: read_file,write_file,list_files,search
disable-model-invocation: true
---

When assisting with DevOps:

1. **Assess** the current infrastructure setup
2. **Review** configuration files (Dockerfile, docker-compose, CI configs)
3. **Suggest improvements** for:
   - Build optimization
   - Security hardening
   - Resource efficiency
   - Monitoring and logging
4. **Generate** configuration files as needed
5. **Document** the setup and any changes made
`,
  },
];
