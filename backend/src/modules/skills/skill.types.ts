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
  reviewStatus: SkillReviewStatus;
  localPath: string | null;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateSkillInput {
  skillKey: string;
  name: string;
  description?: string;
  scope?: SkillScope;
  source?: SkillSource;
  version?: string;
  skillMdContent?: string;
  auxiliaryFiles?: Record<string, string>;
  requiresBins?: string[];
  requiresEnv?: string[];
  tags?: string[];
  localPath?: string;
}

export interface UpdateSkillInput {
  name?: string;
  description?: string;
  version?: string;
  skillMdContent?: string;
  auxiliaryFiles?: Record<string, string>;
  requiresBins?: string[];
  requiresEnv?: string[];
  tags?: string[];
  reviewStatus?: SkillReviewStatus;
  reviewedBy?: string;
}

export interface AgentSkillInstall {
  id: string;
  agentId: string;
  skillCatalogId: string;
  scope: SkillScope;
  enabled: boolean;
  configOverrides: Record<string, unknown> | null;
  installedAt: Date;
}

export interface InstallSkillInput {
  skillCatalogId: string;
  scope?: SkillScope;
  configOverrides?: Record<string, unknown>;
}
