export type PlaygroundSessionStatus = 'active' | 'completed' | 'error' | 'timeout';
export type SecuritySeverity = 'info' | 'warning' | 'critical';

export interface SecurityFinding {
  severity: SecuritySeverity;
  rule: string;
  message: string;
  line?: number;
}

export interface SecurityScanResult {
  passed: boolean;
  findings: SecurityFinding[];
  scannedAt: string;
}

export interface PlaygroundSessionConfig {
  model: string;
  maxToolCalls: number;
  timeoutSeconds: number;
  allowedTools: string[];
  systemPromptOverride?: string;
}

export interface PlaygroundMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolCallId?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: string;
  timestamp: string;
}

export interface ToolCallLogEntry {
  id: string;
  toolName: string;
  args: Record<string, unknown>;
  result: string;
  durationMs: number;
  timestamp: string;
}

export interface BotIdentityFile {
  filename: string;
  content: string;
}

/** A file in the skill's virtual directory */
export interface SkillFile {
  path: string;
  content: string;
}

/** Map of relative path -> file content */
export type SkillFileMap = Record<string, string>;

export interface PlaygroundSession {
  id: string;
  skillCatalogId: string | null;
  agentId: string | null;
  skillSnapshot: string;
  identitySnapshot: BotIdentityFile[] | null;
  skillFiles: SkillFileMap;
  optimizerMessages: PlaygroundMessage[];
  config: PlaygroundSessionConfig;
  status: PlaygroundSessionStatus;
  messages: PlaygroundMessage[];
  toolCallsLog: ToolCallLogEntry[];
  securityScanResult: SecurityScanResult | null;
  errorInfo: Record<string, unknown> | null;
  startedAt: string;
  completedAt: string | null;
  createdAt: string;
}

export interface SkillVersion {
  id: string;
  skillCatalogId: string;
  version: string;
  skillMdContent: string;
  frontmatter: Record<string, unknown> | null;
  auxiliaryFiles: Record<string, string> | null;
  changeNote: string | null;
  createdAt: string;
}

export interface SkillTemplate {
  id: string;
  name: string;
  description: string;
  content: string;
}

export interface SkillFrontmatter {
  name?: string;
  description?: string;
  'allowed-tools'?: string;
  'disable-model-invocation'?: boolean;
  'user-invocable'?: boolean;
  context?: string;
  agent?: string;
  model?: string;
  'argument-hint'?: string;
  metadata?: Record<string, unknown>;
}

export interface ParsedSkill {
  frontmatter: SkillFrontmatter;
  content: string;
  rawFrontmatter: string;
}

export interface ValidateSkillResult {
  valid: boolean;
  errors: Array<{ field: string; message: string }>;
  warnings: Array<{ field: string; message: string }>;
  parsed: ParsedSkill | null;
}

export interface SSEEvent {
  type: 'text-delta' | 'tool-call-begin' | 'tool-call-result' | 'done' | 'error';
  data: Record<string, unknown>;
}
