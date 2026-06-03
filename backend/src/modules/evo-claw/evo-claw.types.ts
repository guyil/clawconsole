// ─── Enums ────────────────────────────────────────────────────────────

export type EvoTriggerType = 'scheduled' | 'manual' | 'skill';

export type EvoRunStatus =
  | 'pending'
  | 'collecting'
  | 'classifying'
  | 'distilling'
  | 'applying'
  | 'completed'
  | 'failed';

export type SignalType = 'evaluative' | 'instructive';
export type SignalPolarity = 'positive' | 'negative' | 'neutral';

export type RuleType = 'constraint' | 'preference' | 'procedure';
export type RuleStatus = 'active' | 'deprecated' | 'merged' | 'superseded';

export type CaseStatus = 'active' | 'deprecated' | 'merged';

export type EvoTargetFile = 'SOUL.md' | 'TOOLS.md' | 'AGENTS.md';

// ─── Evolution Run ────────────────────────────────────────────────────

export interface EvoRun {
  id: number;
  machineId: string;
  agentId: string;
  triggerType: EvoTriggerType;
  status: EvoRunStatus;
  sessionsAnalyzed: number;
  signalsFound: number;
  rulesGenerated: number;
  casesGenerated: number;
  summary: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface CreateEvoRunInput {
  machineId: string;
  agentId: string;
  triggerType: EvoTriggerType;
}

// ─── Evolution Signal ─────────────────────────────────────────────────

export interface EvoSignal {
  id: number;
  machineId: string;
  agentId: string;
  evoRunId: number;
  signalType: SignalType;
  polarity: SignalPolarity | null;
  sourceSessionId: string;
  messageIndexStart: number;
  messageIndexEnd: number;
  rawContent: string;
  hint: string | null;
  classificationReason: string | null;
  processed: boolean;
  createdAt: string;
}

export interface InsertEvoSignalInput {
  machineId: string;
  agentId: string;
  evoRunId: number;
  signalType: SignalType;
  polarity?: SignalPolarity | null;
  sourceSessionId: string;
  messageIndexStart: number;
  messageIndexEnd: number;
  rawContent: string;
  hint?: string | null;
  classificationReason?: string | null;
}

// ─── Evolution Rule ───────────────────────────────────────────────────

export interface EvoRule {
  id: number;
  machineId: string;
  agentId: string;
  evoRunId: number;
  ruleKey: string;
  ruleType: RuleType;
  content: string;
  targetFile: EvoTargetFile;
  targetSection: string | null;
  sourceSignalIds: number[] | null;
  status: RuleStatus;
  confidenceScore: number;
  triggerCount: number;
  positiveFeedbackCount: number;
  negativeFeedbackCount: number;
  mergedIntoId: number | null;
  createdAt: string;
  updatedAt: string;
  deprecatedAt: string | null;
}

export interface InsertEvoRuleInput {
  machineId: string;
  agentId: string;
  evoRunId: number;
  ruleKey: string;
  ruleType: RuleType;
  content: string;
  targetFile: EvoTargetFile;
  targetSection?: string | null;
  sourceSignalIds?: number[] | null;
  confidenceScore?: number;
}

export interface UpdateEvoRuleInput {
  content?: string;
  status?: RuleStatus;
  targetSection?: string;
  confidenceScore?: number;
  mergedIntoId?: number | null;
  deprecatedAt?: string | null;
}

// ─── Evolution Case ───────────────────────────────────────────────────

export interface EvoCase {
  id: number;
  machineId: string;
  agentId: string;
  evoRunId: number;
  caseKey: string;
  scenario: string;
  userQuestionSummary: string;
  botWrongAnswerSummary: string;
  userCorrection: string;
  correctApproach: string;
  sourceSignalIds: number[] | null;
  status: CaseStatus;
  relevanceCount: number;
  mergedIntoId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface InsertEvoCaseInput {
  machineId: string;
  agentId: string;
  evoRunId: number;
  caseKey: string;
  scenario: string;
  userQuestionSummary: string;
  botWrongAnswerSummary: string;
  userCorrection: string;
  correctApproach: string;
  sourceSignalIds?: number[] | null;
}

export interface UpdateEvoCaseInput {
  scenario?: string;
  correctApproach?: string;
  status?: CaseStatus;
  mergedIntoId?: number | null;
}

// ─── Judge Types ──────────────────────────────────────────────────────

export interface ConversationTurn {
  sessionId: string;
  messageIndexStart: number;
  messageIndexEnd: number;
  userMessage: string;
  botResponse: string;
  userFollowUp: string;
  precedingContext: Array<{ role: string; content: string }>;
}

export interface JudgeVerdict {
  signalType: 'evaluative' | 'instructive' | 'none';
  polarity?: SignalPolarity;
  hint?: string;
  reason: string;
  failurePattern?: string;
}

// ─── Distiller Types ──────────────────────────────────────────────────

export interface DistilledRule {
  ruleKey: string;
  ruleType: RuleType;
  content: string;
  targetFile: EvoTargetFile;
  targetSection: string;
  confidenceScore: number;
  sourceSignalIds: number[];
}

export interface DistilledCase {
  caseKey: string;
  scenario: string;
  userQuestionSummary: string;
  botWrongAnswerSummary: string;
  userCorrection: string;
  correctApproach: string;
  sourceSignalIds: number[];
}

// ─── Controller Types ─────────────────────────────────────────────────

export interface ConflictCheckResult {
  hasConflict: boolean;
  conflictingRuleId?: number;
  resolution: 'none' | 'merge' | 'supersede';
  mergedContent?: string;
}

export interface CompressionResult {
  originalCount: number;
  compressedRules: Array<{
    ruleKey: string;
    content: string;
    mergedFromIds: number[];
  }>;
}

// ─── Query Filters ────────────────────────────────────────────────────

export interface EvoRunFilters {
  machineId?: string;
  agentId?: string;
  status?: EvoRunStatus;
  limit?: number;
  offset?: number;
}

export interface EvoRuleFilters {
  machineId?: string;
  agentId?: string;
  status?: RuleStatus;
  targetFile?: EvoTargetFile;
  limit?: number;
  offset?: number;
}

export interface EvoCaseFilters {
  machineId?: string;
  agentId?: string;
  status?: CaseStatus;
  limit?: number;
  offset?: number;
}

// ─── ECA Managed Section Markers ──────────────────────────────────────

export const ECA_SECTION_BEGIN = '<!-- ECA:BEGIN -->';
export const ECA_SECTION_END = '<!-- ECA:END -->';
