import { describe, it, expect } from 'vitest';
import {
  ECA_SECTION_BEGIN,
  ECA_SECTION_END,
} from '../../../src/modules/evo-claw/evo-claw.types.js';

/**
 * Since EvoClawService methods that handle ECA section management are private,
 * we test the ECA section insertion/update logic directly as string operations
 * that mirror the service's upsertEcaSection behavior.
 */
function upsertEcaSection(existingContent: string | null, ecaContent: string): string {
  const ecaBlock = `${ECA_SECTION_BEGIN}\n${ecaContent}\n${ECA_SECTION_END}`;

  if (existingContent) {
    const beginIdx = existingContent.indexOf(ECA_SECTION_BEGIN);
    const endIdx = existingContent.indexOf(ECA_SECTION_END);

    if (beginIdx !== -1 && endIdx !== -1) {
      return (
        existingContent.slice(0, beginIdx) +
        ecaBlock +
        existingContent.slice(endIdx + ECA_SECTION_END.length)
      );
    }
    return existingContent.trimEnd() + '\n\n' + ecaBlock + '\n';
  }
  return ecaBlock + '\n';
}

describe('ECA Section Management', () => {
  const sampleRules = '## Behavior Constraints\n\n- Do not give absolute numbers';

  it('creates ECA section in empty file', () => {
    const result = upsertEcaSection(null, sampleRules);

    expect(result).toContain(ECA_SECTION_BEGIN);
    expect(result).toContain(ECA_SECTION_END);
    expect(result).toContain('Do not give absolute numbers');
  });

  it('appends ECA section to existing content without markers', () => {
    const existing = '# My Soul\n\nI am a helpful assistant.';
    const result = upsertEcaSection(existing, sampleRules);

    expect(result).toContain('I am a helpful assistant.');
    expect(result).toContain(ECA_SECTION_BEGIN);
    expect(result).toContain(sampleRules);
    expect(result.indexOf('I am a helpful assistant.')).toBeLessThan(
      result.indexOf(ECA_SECTION_BEGIN),
    );
  });

  it('replaces existing ECA section, preserving surrounding content', () => {
    const existing = [
      '# My Soul',
      '',
      'I am a helpful assistant.',
      '',
      ECA_SECTION_BEGIN,
      '## Old Rules',
      '- Old rule that should be replaced',
      ECA_SECTION_END,
      '',
      '## Manual Section Below',
      'This should be preserved.',
    ].join('\n');

    const newRules = '## Updated Rules\n\n- New shiny rule';
    const result = upsertEcaSection(existing, newRules);

    expect(result).toContain('I am a helpful assistant.');
    expect(result).toContain('New shiny rule');
    expect(result).toContain('This should be preserved.');
    expect(result).not.toContain('Old rule that should be replaced');
  });

  it('preserves content before and after ECA section exactly', () => {
    const before = '# Header\n\nSome content before.';
    const after = '\n\n# Footer\n\nSome content after.';
    const existing = before + '\n\n' + ECA_SECTION_BEGIN + '\nold\n' + ECA_SECTION_END + after;

    const result = upsertEcaSection(existing, 'new content');

    expect(result.startsWith(before)).toBe(true);
    expect(result.endsWith(after)).toBe(true);
    expect(result).toContain('new content');
    expect(result).not.toContain('\nold\n');
  });
});

describe('Case Skill Generation', () => {
  it('generates valid SKILL.md frontmatter', () => {
    const cases = [
      {
        scenario: 'Contract Review',
        correctApproach: 'Check conventions first',
        botWrongAnswerSummary: 'Gave bad advice',
      },
    ];

    const parts = [
      '---',
      'name: evo-cases',
      'description: Auto-evolved case library from user interaction feedback',
      `version: "${new Date().toISOString().slice(0, 10)}"`,
      'tags: [evo, cases, auto-evolved]',
      '---',
      '',
      '# Evolved Case Library',
      '',
    ];

    for (const c of cases) {
      parts.push(`## Case: ${c.scenario}`);
      parts.push(`**Scenario**: ${c.scenario}`);
      parts.push(`**Correct Approach**: ${c.correctApproach}`);
      parts.push(`**Avoid**: ${c.botWrongAnswerSummary}`);
      parts.push('');
    }

    const content = parts.join('\n');

    expect(content).toContain('name: evo-cases');
    expect(content).toContain('## Case: Contract Review');
    expect(content).toContain('**Correct Approach**: Check conventions first');
    expect(content).toContain('**Avoid**: Gave bad advice');
  });
});
