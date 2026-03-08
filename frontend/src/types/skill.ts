export type SkillScope = 'global' | 'agent';
export type SkillSource = 'clawhub' | 'custom' | 'bundled' | 'local';
export type SkillReviewStatus = 'pending' | 'approved' | 'rejected' | 'deprecated';

export interface SkillCatalogEntry {
  id: string;
  skillKey: string;
  name: string;
  description: string | null;
  scope: SkillScope;
  source: SkillSource;
  version: string | null;
  frontmatter: Record<string, unknown> | null;
  skillMdContent: string | null;
  auxiliaryFiles: Record<string, string> | null;
  requiresBins: string[] | null;
  requiresEnv: string[] | null;
  tags: string[] | null;
  localPath: string | null;
  reviewStatus: SkillReviewStatus;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSkillInput {
  skillKey: string;
  name: string;
  description?: string;
  scope?: SkillScope;
  source?: SkillSource;
  version?: string;
  skillMdContent?: string;
  requiresBins?: string[];
  requiresEnv?: string[];
  tags?: string[];
}

export interface UpdateSkillInput {
  name?: string;
  description?: string;
  version?: string;
  skillMdContent?: string;
  requiresBins?: string[];
  requiresEnv?: string[];
  tags?: string[];
}

export interface AgentSkillInstall {
  id: string;
  agentId: string;
  skillCatalogId: string;
  scope: SkillScope;
  enabled: boolean;
  configOverrides: Record<string, unknown> | null;
  installedAt: string;
  skill?: SkillCatalogEntry;
}

export interface InstallSkillInput {
  skillCatalogId: string;
  scope?: SkillScope;
  configOverrides?: Record<string, unknown>;
}
