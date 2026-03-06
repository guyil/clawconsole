import { describe, it, expect } from 'vitest';
import {
  parseFrontmatter,
  serializeFrontmatter,
  parseSkillFrontmatter,
} from '../../../src/parsers/markdown-frontmatter.parser.js';

describe('parseFrontmatter', () => {
  it('parses YAML frontmatter from markdown', () => {
    const content = `---
name: test-skill
description: "A test skill"
---
# Test Skill

This is the skill body.`;

    const { metadata, body } = parseFrontmatter(content);

    expect(metadata.name).toBe('test-skill');
    expect(metadata.description).toBe('A test skill');
    expect(body.trim()).toBe('# Test Skill\n\nThis is the skill body.');
  });

  it('returns empty metadata when no frontmatter', () => {
    const content = '# Just a heading\n\nSome text.';
    const { metadata, body } = parseFrontmatter(content);

    expect(metadata).toEqual({});
    expect(body).toBe(content);
  });

  it('handles invalid YAML gracefully', () => {
    const content = `---
invalid: [yaml: content
---
Body text`;

    const { metadata, body } = parseFrontmatter(content);
    expect(metadata).toEqual({});
  });
});

describe('serializeFrontmatter', () => {
  it('produces valid frontmatter string', () => {
    const result = serializeFrontmatter(
      { name: 'test', description: 'A test' },
      '# Body\n\nContent here.',
    );

    expect(result).toContain('---');
    expect(result).toContain('name: test');
    expect(result).toContain('# Body');
  });
});

describe('parseSkillFrontmatter', () => {
  it('parses a complete SKILL.md', () => {
    const content = `---
name: feishu-webhook
description: "Send messages to Feishu"
user-invocable: true
disable-model-invocation: false
homepage: https://example.com
---
# Feishu Webhook Skill

Send messages to Feishu groups.`;

    const { frontmatter, body } = parseSkillFrontmatter(content);

    expect(frontmatter.name).toBe('feishu-webhook');
    expect(frontmatter.description).toBe('Send messages to Feishu');
    expect(frontmatter.userInvocable).toBe(true);
    expect(frontmatter.disableModelInvocation).toBe(false);
    expect(frontmatter.homepage).toBe('https://example.com');
    expect(body).toContain('# Feishu Webhook Skill');
  });
});
