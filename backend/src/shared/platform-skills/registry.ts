import type { LangGraphToolDef } from '../langgraph/types.js';
import type { PlatformSkill, SkillContext } from './types.js';
import { skillToLangGraphTool } from './types.js';
import { createChildLogger } from '../logger.js';

const log = createChildLogger('platform-skills');

/**
 * Central registry of platform skills.
 * Skills are registered once at startup and can be selectively converted
 * into LangGraph tools for any AI agent that needs them.
 */
export class PlatformSkillRegistry {
  private skills = new Map<string, PlatformSkill>();
  private ctx: SkillContext;

  constructor(ctx: SkillContext) {
    this.ctx = ctx;
  }

  register(skill: PlatformSkill): void {
    if (this.skills.has(skill.name)) {
      log.warn({ skill: skill.name }, 'Overwriting existing platform skill');
    }
    this.skills.set(skill.name, skill);
    log.info({ skill: skill.name }, 'Platform skill registered');
  }

  registerAll(skills: PlatformSkill[]): void {
    for (const skill of skills) {
      this.register(skill);
    }
  }

  get(name: string): PlatformSkill | undefined {
    return this.skills.get(name);
  }

  has(name: string): boolean {
    return this.skills.has(name);
  }

  listNames(): string[] {
    return Array.from(this.skills.keys());
  }

  /**
   * Convert selected skills (by name) into LangGraph tools.
   * If no names are given, all registered skills are returned.
   */
  toLangGraphTools(names?: string[]): LangGraphToolDef[] {
    const selected = names
      ? names.map((n) => this.skills.get(n)).filter(Boolean) as PlatformSkill[]
      : Array.from(this.skills.values());

    return selected.map((s) => skillToLangGraphTool(s, this.ctx));
  }

  /** The underlying skill context (for direct access when needed). */
  getContext(): SkillContext {
    return this.ctx;
  }
}
