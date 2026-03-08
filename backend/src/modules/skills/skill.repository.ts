import { v4 as uuidv4 } from 'uuid';
import { getDb, type Knex } from '../../shared/db.js';
import type {
  SkillCatalogEntry,
  CreateSkillInput,
  UpdateSkillInput,
  AgentSkillInstall,
  SkillScope,
  SkillSource,
  SkillReviewStatus,
} from './skill.types.js';

// MySQL JSON columns may return parsed objects or strings depending on driver/query
function safeJsonParse<T>(value: unknown): T | null {
  if (!value) return null;
  if (typeof value === 'object') return value as T;
  if (typeof value === 'string') {
    try { return JSON.parse(value) as T; } catch { return null; }
  }
  return null;
}

export class SkillRepository {
  private get db(): Knex {
    return getDb();
  }

  // --- Catalog ---

  async findAll(filters?: {
    source?: SkillSource;
    scope?: SkillScope;
    reviewStatus?: SkillReviewStatus;
    tag?: string;
  }): Promise<SkillCatalogEntry[]> {
    let query = this.db('skills_catalog').select('*');
    if (filters?.source) query = query.where('source', filters.source);
    if (filters?.scope) query = query.where('scope', filters.scope);
    if (filters?.reviewStatus) query = query.where('review_status', filters.reviewStatus);
    if (filters?.tag) query = query.whereRaw('JSON_CONTAINS(tags, ?)', [JSON.stringify(filters.tag)]);
    const rows = await query.orderBy('name', 'asc');
    return rows.map(this.toCatalogEntry);
  }

  async findAllTags(): Promise<string[]> {
    const rows = await this.db('skills_catalog')
      .whereNotNull('tags')
      .select('tags');
    const tagSet = new Set<string>();
    for (const row of rows) {
      const tags = safeJsonParse<string[]>(row.tags);
      if (tags) tags.forEach((t) => tagSet.add(t));
    }
    return Array.from(tagSet).sort();
  }

  async findById(id: string): Promise<SkillCatalogEntry | null> {
    const row = await this.db('skills_catalog').where('id', id).first();
    return row ? this.toCatalogEntry(row) : null;
  }

  async findByKey(skillKey: string): Promise<SkillCatalogEntry | null> {
    const row = await this.db('skills_catalog').where('skill_key', skillKey).first();
    return row ? this.toCatalogEntry(row) : null;
  }

  async create(input: CreateSkillInput): Promise<SkillCatalogEntry> {
    const id = uuidv4();
    const now = new Date();

    await this.db('skills_catalog').insert({
      id,
      skill_key: input.skillKey,
      name: input.name,
      description: input.description ?? null,
      scope: input.scope ?? 'global',
      source: input.source ?? 'custom',
      version: input.version ?? null,
      frontmatter: null,
      skill_md_content: input.skillMdContent ?? null,
      auxiliary_files: input.auxiliaryFiles ? JSON.stringify(input.auxiliaryFiles) : null,
      requires_bins: input.requiresBins ? JSON.stringify(input.requiresBins) : null,
      requires_env: input.requiresEnv ? JSON.stringify(input.requiresEnv) : null,
      tags: input.tags ? JSON.stringify(input.tags) : null,
      local_path: input.localPath ?? null,
      review_status: 'pending',
      created_at: now,
      updated_at: now,
    });

    return (await this.findById(id))!;
  }

  async update(id: string, input: UpdateSkillInput): Promise<SkillCatalogEntry | null> {
    const updates: Record<string, unknown> = { updated_at: new Date() };
    if (input.name !== undefined) updates.name = input.name;
    if (input.description !== undefined) updates.description = input.description;
    if (input.version !== undefined) updates.version = input.version;
    if (input.skillMdContent !== undefined) updates.skill_md_content = input.skillMdContent;
    if (input.auxiliaryFiles !== undefined) updates.auxiliary_files = JSON.stringify(input.auxiliaryFiles);
    if (input.requiresBins !== undefined) updates.requires_bins = JSON.stringify(input.requiresBins);
    if (input.requiresEnv !== undefined) updates.requires_env = JSON.stringify(input.requiresEnv);
    if (input.tags !== undefined) updates.tags = JSON.stringify(input.tags);
    if (input.reviewStatus !== undefined) {
      updates.review_status = input.reviewStatus;
      updates.reviewed_at = new Date();
    }
    if (input.reviewedBy !== undefined) updates.reviewed_by = input.reviewedBy;

    await this.db('skills_catalog').where('id', id).update(updates);
    return this.findById(id);
  }

  async delete(id: string): Promise<boolean> {
    const deleted = await this.db('skills_catalog').where('id', id).delete();
    return deleted > 0;
  }

  // --- Agent Skills ---

  async findAgentSkills(agentId: string): Promise<Array<AgentSkillInstall & { skill: SkillCatalogEntry }>> {
    const rows = await this.db('agent_skills')
      .join('skills_catalog', 'agent_skills.skill_catalog_id', 'skills_catalog.id')
      .where('agent_skills.agent_id', agentId)
      .select(
        'agent_skills.id',
        'agent_skills.agent_id',
        'agent_skills.skill_catalog_id',
        'agent_skills.scope',
        'agent_skills.enabled',
        'agent_skills.config_overrides',
        'agent_skills.installed_at',
        'skills_catalog.id as skill_id',
        'skills_catalog.skill_key',
        'skills_catalog.name as skill_name',
        'skills_catalog.description as skill_description',
        'skills_catalog.source as skill_source',
        'skills_catalog.review_status as skill_review_status',
      );

    return rows.map((row) => ({
      id: row.id as string,
      agentId: row.agent_id as string,
      skillCatalogId: row.skill_catalog_id as string,
      scope: row.scope as SkillScope,
      enabled: Boolean(row.enabled),
      configOverrides: row.config_overrides ? JSON.parse(row.config_overrides as string) : null,
      installedAt: new Date(row.installed_at as string),
      skill: this.toCatalogEntry(row),
    }));
  }

  async installSkillOnAgent(agentId: string, skillCatalogId: string, scope: SkillScope, configOverrides?: Record<string, unknown>): Promise<AgentSkillInstall> {
    const id = uuidv4();
    await this.db('agent_skills').insert({
      id,
      agent_id: agentId,
      skill_catalog_id: skillCatalogId,
      scope,
      enabled: true,
      config_overrides: configOverrides ? JSON.stringify(configOverrides) : null,
      installed_at: new Date(),
    });

    const row = await this.db('agent_skills').where('id', id).first();
    return {
      id: row!.id as string,
      agentId: row!.agent_id as string,
      skillCatalogId: row!.skill_catalog_id as string,
      scope: row!.scope as SkillScope,
      enabled: Boolean(row!.enabled),
      configOverrides: row!.config_overrides ? JSON.parse(row!.config_overrides as string) : null,
      installedAt: new Date(row!.installed_at as string),
    };
  }

  async uninstallSkillFromAgent(agentId: string, skillCatalogId: string): Promise<boolean> {
    const deleted = await this.db('agent_skills')
      .where({ agent_id: agentId, skill_catalog_id: skillCatalogId })
      .delete();
    return deleted > 0;
  }

  private toCatalogEntry(row: Record<string, unknown>): SkillCatalogEntry {
    const id = (row.skill_id ?? row.id) as string;
    return {
      id,
      skillKey: row.skill_key as string,
      name: (row.skill_name ?? row.name) as string,
      description: (row.skill_description ?? row.description) as string | null,
      scope: row.scope as SkillScope,
      source: (row.skill_source ?? row.source) as SkillSource,
      version: row.version as string | null,
      frontmatter: safeJsonParse<Record<string, unknown>>(row.frontmatter),
      skillMdContent: row.skill_md_content as string | null,
      auxiliaryFiles: safeJsonParse<Record<string, string>>(row.auxiliary_files),
      requiresBins: safeJsonParse<string[]>(row.requires_bins),
      requiresEnv: safeJsonParse<string[]>(row.requires_env),
      tags: safeJsonParse<string[]>(row.tags),
      localPath: (row.local_path as string) ?? null,
      reviewStatus: (row.skill_review_status ?? row.review_status) as SkillReviewStatus,
      reviewedBy: row.reviewed_by as string | null,
      reviewedAt: row.reviewed_at ? new Date(row.reviewed_at as string) : null,
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    };
  }
}
