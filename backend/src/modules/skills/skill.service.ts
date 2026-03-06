import type { SkillRepository } from './skill.repository.js';
import type {
  SkillCatalogEntry,
  CreateSkillInput,
  UpdateSkillInput,
  AgentSkillInstall,
  InstallSkillInput,
  SkillScope,
  SkillSource,
  SkillReviewStatus,
} from './skill.types.js';
import type { FileTransfer } from '../../transport/file-transfer.js';
import type { MachineService } from '../machines/machine.service.js';
import type { AgentRepository } from '../agents/agent.repository.js';
import { NotFoundError, ValidationError } from '../../shared/errors.js';
import { parseSkillFrontmatter } from '../../parsers/markdown-frontmatter.parser.js';
import { createChildLogger } from '../../shared/logger.js';
import JSZip from 'jszip';

const log = createChildLogger('skill-service');

function detectSource(url: string): SkillSource {
  if (url.includes('clawhub.ai')) return 'clawhub';
  return 'custom';
}

function extractSkillKeyFromUrl(url: string): string {
  const u = new URL(url);
  const segments = u.pathname.split('/').filter(Boolean);
  const last = segments[segments.length - 1] ?? 'imported-skill';
  return last
    .replace(/\.md$/i, '')
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .toLowerCase();
}

function toGitHubRawUrl(url: string): string | null {
  const m = url.match(
    /github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)/,
  );
  if (m) {
    return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}/${m[4]}`;
  }
  return null;
}

function looksLikeMarkdown(text: string): boolean {
  const trimmed = text.trimStart();
  return (
    trimmed.startsWith('---') ||
    trimmed.startsWith('#') ||
    trimmed.startsWith('```') ||
    /^[\w-]+:/.test(trimmed)
  );
}

/**
 * Build candidate URLs for fetching the raw SKILL.md file from a registry page URL.
 * Covers ClawHub, GitHub, and generic patterns.
 */
function buildRawSkillMdCandidates(pageUrl: string, skillKey: string): string[] {
  const u = new URL(pageUrl);
  const candidates: string[] = [];
  const segments = u.pathname.split('/').filter(Boolean);

  if (u.hostname.includes('clawhub.ai')) {
    // ClawHub patterns: /skills/{key}, /{owner}/{key}
    candidates.push(`${u.origin}/api/skills/${skillKey}/raw`);
    candidates.push(`${u.origin}/api/skills/${skillKey}/SKILL.md`);
    candidates.push(`${u.origin}/raw/${segments.join('/')}/SKILL.md`);
    if (segments.length >= 2) {
      candidates.push(`${u.origin}/api/skills/${segments[0]}/${segments[1]}/raw`);
      candidates.push(`${u.origin}/api/skills/${segments[0]}/${segments[1]}/SKILL.md`);
    }
  }

  if (u.hostname.includes('github.com') && segments.length >= 2) {
    // GitHub tree/directory URL → raw SKILL.md inside
    const [owner, repo, ...rest] = segments;
    const branch = rest[0] === 'tree' ? rest[1] : 'main';
    const path = rest[0] === 'tree' ? rest.slice(2).join('/') : rest.join('/');
    candidates.push(`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}/SKILL.md`);
    candidates.push(`https://raw.githubusercontent.com/${owner}/${repo}/main/${path}/SKILL.md`);
  }

  // Generic: append /SKILL.md to the page URL
  const base = pageUrl.replace(/\/+$/, '');
  candidates.push(`${base}/SKILL.md`);
  candidates.push(`${base}/raw/SKILL.md`);

  return candidates;
}

async function tryFetchMarkdown(urls: string[]): Promise<string | null> {
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(10_000),
        headers: { Accept: 'text/plain, text/markdown' },
      });
      if (!res.ok) continue;
      const text = await res.text();
      if (text.trim().length > 0 && looksLikeMarkdown(text)) {
        log.info({ url }, 'Fetched raw SKILL.md from candidate URL');
        return text;
      }
    } catch { /* try next */ }
  }
  return null;
}

interface HtmlSkillMeta {
  name: string;
  slug: string | null;
  description: string | null;
  version: string | null;
  owner: string | null;
}

// Extract skill metadata from ClawHub/SkillsMP HTML pages
function extractSkillMetaFromHtml(html: string): HtmlSkillMeta | null {
  const ogTitle = html.match(/<meta\s+property="og:title"\s+content="([^"]*)"/) ??
                  html.match(/<meta\s+name="og:title"\s+content="([^"]*)"/) ??
                  html.match(/<title>([^<]*)<\/title>/);
  const ogDesc = html.match(/<meta\s+(?:property|name)="(?:og:)?description"\s+content="([^"]*)"/) ??
                 html.match(/<meta\s+name="description"\s+content="([^"]*)"/) ;

  // Extract structured data from ClawHub's embedded router state
  const versionMatch = html.match(/version:"([^"]+)"/);
  const ownerMatch = html.match(/owner:"([^"]+)"/);
  const displayMatch = html.match(/displayName:"([^"]+)"/);
  const summaryMatch = html.match(/summary:"([^"]+)"/);

  // Extract slug from og:image URL (?slug=weather) or canonical URL path
  const slugFromOg = html.match(/og:image[^>]*slug=([^&"]+)/)?.[1];
  const canonicalUrl = html.match(/<link\s+rel="canonical"\s+href="([^"]+)"/)?.[1];
  const slugFromCanonical = canonicalUrl ? new URL(canonicalUrl).pathname.split('/').filter(Boolean).pop() : null;

  const name = displayMatch?.[1] ?? ogTitle?.[1]?.replace(/\s*[—–-]\s*ClawHub.*$/i, '').trim() ?? null;
  if (!name) return null;

  return {
    name,
    slug: slugFromOg ?? slugFromCanonical ?? null,
    description: summaryMatch?.[1] ?? ogDesc?.[1] ?? null,
    version: versionMatch?.[1] ?? null,
    owner: ownerMatch?.[1] ?? null,
  };
}

const CLAWHUB_DOWNLOAD_BASE = 'https://wry-manatee-359.convex.site/api/v1/download';
const BINARY_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.svg',
  '.zip', '.tar', '.gz', '.bz2', '.7z', '.mp3', '.mp4', '.wav', '.pdf', '.db', '.sqlite',
  '.woff', '.woff2', '.ttf', '.eot', '.exe', '.dll', '.so', '.dylib', '.bin', '.o']);

/**
 * Download a skill ZIP from ClawHub and extract SKILL.md + auxiliary files.
 * Returns null if download or extraction fails.
 */
async function downloadClawHubSkill(slug: string, version?: string | null): Promise<{
  skillMdContent: string | null;
  auxiliaryFiles: Record<string, string>;
} | null> {
  try {
    const params = new URLSearchParams({ slug });
    if (version) params.set('version', version);
    const downloadUrl = `${CLAWHUB_DOWNLOAD_BASE}?${params}`;

    const res = await fetch(downloadUrl, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) {
      log.warn({ slug, version, status: res.status }, 'ClawHub download failed');
      return null;
    }

    const buffer = await res.arrayBuffer();
    const zip = await JSZip.loadAsync(buffer);

    let skillMdContent: string | null = null;
    const auxiliaryFiles: Record<string, string> = {};

    for (const [path, file] of Object.entries(zip.files)) {
      if (file.dir) continue;
      const ext = path.substring(path.lastIndexOf('.')).toLowerCase();
      if (BINARY_EXTENSIONS.has(ext)) continue;
      // Skip metadata files not useful for display
      if (path === '_meta.json') continue;

      const text = await file.async('string');
      if (path === 'SKILL.md' || path.endsWith('/SKILL.md')) {
        skillMdContent = text;
      } else {
        auxiliaryFiles[path] = text;
      }
    }

    log.info({ slug, fileCount: Object.keys(auxiliaryFiles).length + (skillMdContent ? 1 : 0) },
      'ClawHub skill ZIP extracted');
    return { skillMdContent, auxiliaryFiles };
  } catch (err) {
    log.warn({ slug, err }, 'ClawHub skill download/extract failed');
    return null;
  }
}

export class SkillService {
  constructor(
    private repo: SkillRepository,
    private fileTransfer: FileTransfer,
    private machineService: MachineService,
    private agentRepo: AgentRepository,
  ) {}

  async listSkills(filters?: {
    source?: SkillSource;
    scope?: SkillScope;
    reviewStatus?: SkillReviewStatus;
  }): Promise<SkillCatalogEntry[]> {
    return this.repo.findAll(filters);
  }

  async getSkill(id: string): Promise<SkillCatalogEntry> {
    const skill = await this.repo.findById(id);
    if (!skill) throw new NotFoundError('Skill', id);
    return skill;
  }

  async createSkill(input: CreateSkillInput): Promise<SkillCatalogEntry> {
    if (!input.skillKey || input.skillKey.trim().length === 0) {
      throw new ValidationError('Skill key cannot be empty');
    }
    if (!input.name || input.name.trim().length === 0) {
      throw new ValidationError('Skill name cannot be empty');
    }

    const existing = await this.repo.findByKey(input.skillKey);
    if (existing) {
      throw new ValidationError(`Skill with key "${input.skillKey}" already exists`);
    }

    return this.repo.create(input);
  }

  async updateSkill(id: string, input: UpdateSkillInput): Promise<SkillCatalogEntry> {
    const skill = await this.getSkill(id);
    const updated = await this.repo.update(id, input);
    if (!updated) throw new NotFoundError('Skill', id);
    return updated;
  }

  async deleteSkill(id: string): Promise<void> {
    const deleted = await this.repo.delete(id);
    if (!deleted) throw new NotFoundError('Skill', id);
  }

  async approveSkill(id: string, reviewedBy: string): Promise<SkillCatalogEntry> {
    await this.getSkill(id);
    const updated = await this.repo.update(id, {
      reviewStatus: 'approved',
      reviewedBy,
    });
    log.info({ skillId: id, reviewedBy }, 'Skill approved');
    return updated!;
  }

  async rejectSkill(id: string, reviewedBy: string): Promise<SkillCatalogEntry> {
    await this.getSkill(id);
    const updated = await this.repo.update(id, {
      reviewStatus: 'rejected',
      reviewedBy,
    });
    log.info({ skillId: id, reviewedBy }, 'Skill rejected');
    return updated!;
  }

  async getAgentSkills(agentId: string): Promise<Array<AgentSkillInstall & { skill: SkillCatalogEntry }>> {
    return this.repo.findAgentSkills(agentId);
  }

  async installSkillOnAgent(agentId: string, input: InstallSkillInput): Promise<AgentSkillInstall> {
    const skill = await this.getSkill(input.skillCatalogId);
    if (skill.reviewStatus !== 'approved') {
      throw new ValidationError(`Skill "${skill.name}" must be approved before installation (current status: ${skill.reviewStatus})`);
    }

    const scope = input.scope ?? 'agent';
    return this.repo.installSkillOnAgent(agentId, input.skillCatalogId, scope, input.configOverrides);
  }

  async uninstallSkillFromAgent(agentId: string, skillCatalogId: string): Promise<void> {
    const removed = await this.repo.uninstallSkillFromAgent(agentId, skillCatalogId);
    if (!removed) {
      throw new NotFoundError('AgentSkill', `${agentId}/${skillCatalogId}`);
    }
  }

  async importSkillFromUrl(url: string): Promise<SkillCatalogEntry> {
    const source = detectSource(url);
    let content: string | null = null;

    // Strategy 1: GitHub blob URL → raw URL
    const rawUrl = toGitHubRawUrl(url);
    if (rawUrl) {
      const res = await fetch(rawUrl, { signal: AbortSignal.timeout(15_000) });
      if (res.ok) content = await res.text();
    }

    // Strategy 2: Fetch URL directly
    if (!content) {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(15_000),
        headers: { Accept: 'text/plain, text/markdown, text/html' },
      });
      if (!res.ok) {
        throw new ValidationError(`Failed to fetch URL: ${res.status} ${res.statusText}`);
      }
      content = await res.text();
    }

    if (!content || content.trim().length === 0) {
      throw new ValidationError('URL returned empty content');
    }

    // If HTML page (SPA), extract metadata from meta tags / embedded data
    const isHtml = !looksLikeMarkdown(content) && (content.includes('<!DOCTYPE') || content.includes('<html'));

    if (isHtml) {
      // Try to find a raw SKILL.md link and follow it
      const skillMdMatch = content.match(
        /href="(https?:\/\/[^"]*(?:raw|SKILL\.md)[^"]*)"/i,
      );
      if (skillMdMatch) {
        try {
          const followRes = await fetch(skillMdMatch[1], { signal: AbortSignal.timeout(10_000) });
          if (followRes.ok) {
            const followed = await followRes.text();
            if (looksLikeMarkdown(followed)) content = followed;
          }
        } catch { /* ignore follow errors */ }
      }

      // Try derived candidate URLs before falling back to <pre> extraction
      if (!looksLikeMarkdown(content)) {
        const skillKey = extractSkillKeyFromUrl(url);
        const candidates = buildRawSkillMdCandidates(url, skillKey);
        const fetched = await tryFetchMarkdown(candidates);
        if (fetched) content = fetched;
      }

      // Extract from <pre> or <code> blocks
      if (!looksLikeMarkdown(content)) {
        const preMatch = content.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
        if (preMatch) {
          const extracted = preMatch[1]
            .replace(/<[^>]+>/g, '')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&')
            .replace(/&#39;/g, "'")
            .replace(/&quot;/g, '"');
          if (looksLikeMarkdown(extracted)) content = extracted;
        }
      }
    }

    // Parse as markdown if we have markdown content
    if (looksLikeMarkdown(content)) {
      const { frontmatter } = parseSkillFrontmatter(content);
      const skillKey = frontmatter.name ?? extractSkillKeyFromUrl(url);
      const skillName = frontmatter.name ?? skillKey;

      const existing = await this.repo.findByKey(skillKey);
      if (existing) {
        const updated = await this.repo.update(existing.id, {
          skillMdContent: content,
          name: frontmatter.name ?? existing.name,
          description: frontmatter.description ?? existing.description ?? undefined,
          requiresBins: frontmatter.metadata?.openclaw?.requires?.bins,
          requiresEnv: frontmatter.metadata?.openclaw?.requires?.env,
        });
        log.info({ skillKey, url, action: 'updated' }, 'Skill reimported from URL');
        return updated!;
      }

      const created = await this.repo.create({
        skillKey,
        name: skillName,
        description: frontmatter.description,
        scope: 'global',
        source,
        skillMdContent: content,
        requiresBins: frontmatter.metadata?.openclaw?.requires?.bins,
        requiresEnv: frontmatter.metadata?.openclaw?.requires?.env,
      });
      log.info({ skillKey, url, skillId: created.id }, 'Skill imported from URL');
      return created;
    }

    // Fall back to HTML metadata extraction (for SPAs like ClawHub)
    if (isHtml) {
      const meta = extractSkillMetaFromHtml(content);
      if (!meta) {
        throw new ValidationError('Could not extract skill metadata from the page. Try using a direct SKILL.md or GitHub raw link.');
      }

      const skillKey = meta.slug ?? extractSkillKeyFromUrl(url);

      // For ClawHub, download the skill ZIP to get SKILL.md + auxiliary files
      let skillMdContent: string | undefined;
      let auxiliaryFiles: Record<string, string> | undefined;
      let parsedBins: string[] | undefined;
      let parsedEnv: string[] | undefined;

      if (source === 'clawhub' && (meta.slug || skillKey)) {
        const downloaded = await downloadClawHubSkill(meta.slug ?? skillKey, meta.version);
        if (downloaded) {
          skillMdContent = downloaded.skillMdContent ?? undefined;
          if (Object.keys(downloaded.auxiliaryFiles).length > 0) {
            auxiliaryFiles = downloaded.auxiliaryFiles;
          }
          if (skillMdContent) {
            const { frontmatter } = parseSkillFrontmatter(skillMdContent);
            if (frontmatter.name) meta.name = frontmatter.name;
            if (frontmatter.description) meta.description = frontmatter.description;
            parsedBins = frontmatter.metadata?.openclaw?.requires?.bins;
            parsedEnv = frontmatter.metadata?.openclaw?.requires?.env;
          }
        }
      }

      const existing = await this.repo.findByKey(skillKey);
      if (existing) {
        const updated = await this.repo.update(existing.id, {
          name: meta.name,
          description: meta.description ?? existing.description ?? undefined,
          version: meta.version ?? undefined,
          skillMdContent,
          auxiliaryFiles,
          requiresBins: parsedBins,
          requiresEnv: parsedEnv,
        });
        log.info({ skillKey, url, action: 'updated', hasContent: !!skillMdContent },
          'Skill reimported from URL (HTML meta)');
        return updated!;
      }

      const created = await this.repo.create({
        skillKey,
        name: meta.name,
        description: meta.description ?? undefined,
        scope: 'global',
        source,
        version: meta.version ?? undefined,
        skillMdContent,
        auxiliaryFiles,
        requiresBins: parsedBins,
        requiresEnv: parsedEnv,
      });
      log.info({ skillKey, url, skillId: created.id, hasContent: !!skillMdContent },
        'Skill imported from URL (HTML meta)');
      return created;
    }

    throw new ValidationError('Could not parse skill content from URL. Please provide a direct link to a SKILL.md file.');
  }

  async importSkillFromRemote(
    machineId: string,
    skillKey: string,
    scope: SkillScope,
  ): Promise<SkillCatalogEntry> {
    const machine = await this.machineService.getMachine(machineId);
    const connInfo = this.machineService.toConnectionInfo(machine);

    const skillDir = scope === 'global'
      ? `${machine.openclawHome}/skills/${skillKey}`
      : `${machine.openclawHome}/workspace-*/skills/${skillKey}`;

    const remotePath = scope === 'global'
      ? `${machine.openclawHome}/skills/${skillKey}/SKILL.md`
      : `${machine.openclawHome}/skills/${skillKey}/SKILL.md`;

    const content = await this.fileTransfer.downloadFile(connInfo, remotePath);
    const { frontmatter } = parseSkillFrontmatter(content);

    const existing = await this.repo.findByKey(skillKey);

    if (existing) {
      const updated = await this.repo.update(existing.id, {
        skillMdContent: content,
        name: frontmatter.name ?? existing.name,
        description: frontmatter.description ?? existing.description ?? undefined,
        requiresBins: frontmatter.metadata?.openclaw?.requires?.bins,
        requiresEnv: frontmatter.metadata?.openclaw?.requires?.env,
      });
      log.info({ skillKey, machineId, action: 'updated' }, 'Skill reimported from remote');
      return updated!;
    }

    const created = await this.repo.create({
      skillKey,
      name: frontmatter.name ?? skillKey,
      description: frontmatter.description,
      scope,
      source: 'custom',
      skillMdContent: content,
      requiresBins: frontmatter.metadata?.openclaw?.requires?.bins,
      requiresEnv: frontmatter.metadata?.openclaw?.requires?.env,
    });

    log.info({ skillKey, machineId, skillId: created.id }, 'Skill imported from remote');
    return created;
  }

  async deploySkillToMachine(
    skillId: string,
    machineId: string,
    scope: SkillScope,
    agentId?: string,
  ): Promise<void> {
    const skill = await this.getSkill(skillId);
    if (!skill.skillMdContent) {
      throw new ValidationError(`Skill "${skill.name}" has no SKILL.md content to deploy`);
    }

    const machine = await this.machineService.getMachine(machineId);
    const connInfo = this.machineService.toConnectionInfo(machine);

    let skillDir: string;

    if (scope === 'agent' && agentId) {
      const agent = await this.agentRepo.findById(agentId);
      if (!agent) throw new NotFoundError('Agent', agentId);
      const workspacePath = agent.workspacePath ?? 'workspace';
      skillDir = `${machine.openclawHome}/${workspacePath}/skills/${skill.skillKey}`;
    } else {
      skillDir = `${machine.openclawHome}/skills/${skill.skillKey}`;
    }

    await this.fileTransfer.ensureDirectory(connInfo, skillDir);
    await this.fileTransfer.uploadFile(
      connInfo,
      `${skillDir}/SKILL.md`,
      skill.skillMdContent,
    );

    // Deploy auxiliary files alongside SKILL.md
    if (skill.auxiliaryFiles) {
      for (const [fileName, content] of Object.entries(skill.auxiliaryFiles)) {
        const subDir = fileName.includes('/') ? `${skillDir}/${fileName.substring(0, fileName.lastIndexOf('/'))}` : null;
        if (subDir) await this.fileTransfer.ensureDirectory(connInfo, subDir);
        await this.fileTransfer.uploadFile(connInfo, `${skillDir}/${fileName}`, content);
      }
    }

    log.info({ skillId, skillKey: skill.skillKey, machineId, scope, agentId }, 'Skill deployed to machine');
  }
}
