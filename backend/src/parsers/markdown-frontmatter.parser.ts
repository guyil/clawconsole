import yaml from 'js-yaml';

export interface ParsedFrontmatter {
  metadata: Record<string, unknown>;
  body: string;
}

export function parseFrontmatter(content: string): ParsedFrontmatter {
  const fmRegex = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;
  const match = content.match(fmRegex);

  if (!match) {
    return { metadata: {}, body: content };
  }

  try {
    const metadata = yaml.load(match[1]) as Record<string, unknown>;
    return {
      metadata: metadata && typeof metadata === 'object' ? metadata : {},
      body: match[2],
    };
  } catch {
    return { metadata: {}, body: content };
  }
}

export function serializeFrontmatter(metadata: Record<string, unknown>, body: string): string {
  const yamlStr = yaml.dump(metadata, { lineWidth: -1, noRefs: true }).trim();
  return `---\n${yamlStr}\n---\n${body}`;
}

export interface SkillFrontmatter {
  name?: string;
  description?: string;
  homepage?: string;
  userInvocable?: boolean;
  disableModelInvocation?: boolean;
  commandDispatch?: string;
  commandTool?: string;
  metadata?: {
    openclaw?: {
      requires?: {
        bins?: string[];
        anyBins?: string[];
        env?: string[];
        config?: string[];
      };
      primaryEnv?: string;
      emoji?: string;
      install?: Record<string, unknown>;
    };
  };
}

export function parseSkillFrontmatter(content: string): { frontmatter: SkillFrontmatter; body: string } {
  const { metadata, body } = parseFrontmatter(content);

  // Merge openclaw and clawdbot namespaces (clawdbot is a legacy alias)
  const rawMeta = metadata.metadata as Record<string, unknown> | undefined;
  const openclawMeta = rawMeta?.openclaw ?? rawMeta?.clawdbot ?? undefined;

  const frontmatter: SkillFrontmatter = {
    name: metadata.name as string | undefined,
    description: metadata.description as string | undefined,
    homepage: metadata.homepage as string | undefined,
    userInvocable: metadata['user-invocable'] as boolean | undefined,
    disableModelInvocation: metadata['disable-model-invocation'] as boolean | undefined,
    commandDispatch: metadata['command-dispatch'] as string | undefined,
    commandTool: metadata['command-tool'] as string | undefined,
    metadata: openclawMeta
      ? { openclaw: openclawMeta as NonNullable<NonNullable<SkillFrontmatter['metadata']>['openclaw']> }
      : undefined,
  };

  return { frontmatter, body };
}
