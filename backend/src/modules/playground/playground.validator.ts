import yaml from 'js-yaml';
import type {
  ParsedSkill,
  ValidateSkillResult,
  SecurityScanResult,
  SecurityFinding,
  SkillFrontmatter,
} from './playground.types.js';
import { createChildLogger } from '../../shared/logger.js';

const log = createChildLogger('playground-validator');

const FRONTMATTER_REGEX = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;

const VALID_FRONTMATTER_KEYS = new Set([
  'name',
  'description',
  'allowed-tools',
  'disable-model-invocation',
  'user-invocable',
  'context',
  'agent',
  'model',
  'argument-hint',
  'metadata',
  'hooks',
]);

// Patterns that indicate potential security risks in skill content
const SECURITY_RULES: Array<{
  id: string;
  severity: 'info' | 'warning' | 'critical';
  pattern: RegExp;
  message: string;
}> = [
  {
    id: 'shell-injection',
    severity: 'critical',
    pattern: /\$\(.*\)|`[^`]+`/,
    message: 'Shell command substitution detected — could enable injection',
  },
  {
    id: 'eval-usage',
    severity: 'critical',
    pattern: /\beval\s*\(/,
    message: 'eval() usage detected — arbitrary code execution risk',
  },
  {
    id: 'require-import',
    severity: 'critical',
    pattern: /\brequire\s*\(|import\s*\(/,
    message: 'Dynamic module loading detected',
  },
  {
    id: 'sudo-usage',
    severity: 'warning',
    pattern: /\bsudo\b/,
    message: 'sudo reference detected — skill should not need elevated privileges',
  },
  {
    id: 'path-traversal',
    severity: 'warning',
    pattern: /\.\.\//,
    message: 'Path traversal pattern detected',
  },
  {
    id: 'env-leak',
    severity: 'warning',
    pattern: /process\.env|\.env\b/,
    message: 'Direct environment variable access — use requires_env for declarations',
  },
  {
    id: 'network-wildcard',
    severity: 'warning',
    pattern: /0\.0\.0\.0|INADDR_ANY/,
    message: 'Wildcard network binding detected',
  },
  {
    id: 'no-allowed-tools',
    severity: 'info',
    pattern: /.*/,
    message: 'No allowed-tools restriction — all tools will be available',
  },
  {
    id: 'large-content',
    severity: 'info',
    pattern: /.{5000,}/s,
    message: 'Skill content exceeds 5000 characters — consider splitting into auxiliary files',
  },
];

export function parseSkillMd(raw: string): ParsedSkill | null {
  const match = FRONTMATTER_REGEX.exec(raw);
  if (!match) {
    return {
      frontmatter: {},
      content: raw.trim(),
      rawFrontmatter: '',
    };
  }

  try {
    const frontmatter = yaml.load(match[1]) as SkillFrontmatter;
    return {
      frontmatter: frontmatter ?? {},
      content: match[2].trim(),
      rawFrontmatter: match[1],
    };
  } catch (err) {
    log.warn({ err }, 'Failed to parse SKILL.md frontmatter');
    return null;
  }
}

export function validateSkillMd(raw: string): ValidateSkillResult {
  const errors: Array<{ field: string; message: string }> = [];
  const warnings: Array<{ field: string; message: string }> = [];

  if (!raw || raw.trim().length === 0) {
    return { valid: false, errors: [{ field: 'content', message: 'Skill content is empty' }], warnings: [], parsed: null };
  }

  const parsed = parseSkillMd(raw);
  if (!parsed) {
    return { valid: false, errors: [{ field: 'frontmatter', message: 'Invalid YAML frontmatter' }], warnings: [], parsed: null };
  }

  const fm = parsed.frontmatter;

  // Validate frontmatter keys
  if (parsed.rawFrontmatter) {
    const parsedYaml = yaml.load(parsed.rawFrontmatter) as Record<string, unknown> | null;
    if (parsedYaml) {
      for (const key of Object.keys(parsedYaml)) {
        if (!VALID_FRONTMATTER_KEYS.has(key)) {
          warnings.push({ field: `frontmatter.${key}`, message: `Unknown frontmatter key: ${key}` });
        }
      }
    }
  }

  // Required: description recommended
  if (!fm.description) {
    warnings.push({ field: 'frontmatter.description', message: 'description is recommended so the agent knows when to use this skill' });
  }

  // name validation
  if (fm.name && !/^[a-z0-9-]+$/.test(fm.name)) {
    errors.push({ field: 'frontmatter.name', message: 'name must contain only lowercase letters, numbers, and hyphens' });
  }
  if (fm.name && fm.name.length > 64) {
    errors.push({ field: 'frontmatter.name', message: 'name must be 64 characters or fewer' });
  }

  // Content not empty
  if (!parsed.content || parsed.content.trim().length === 0) {
    errors.push({ field: 'content', message: 'Skill must have instruction content after frontmatter' });
  }

  return { valid: errors.length === 0, errors, warnings, parsed };
}

export function scanSkillSecurity(raw: string): SecurityScanResult {
  const findings: SecurityFinding[] = [];
  const lines = raw.split('\n');

  for (const rule of SECURITY_RULES) {
    // Skip the catch-all rules if conditions aren't met
    if (rule.id === 'no-allowed-tools') {
      const parsed = parseSkillMd(raw);
      if (parsed?.frontmatter['allowed-tools']) continue;
      findings.push({ severity: rule.severity, rule: rule.id, message: rule.message });
      continue;
    }

    if (rule.id === 'large-content') {
      if (raw.length > 5000) {
        findings.push({ severity: rule.severity, rule: rule.id, message: rule.message });
      }
      continue;
    }

    // Line-by-line scan
    for (let i = 0; i < lines.length; i++) {
      if (rule.pattern.test(lines[i])) {
        findings.push({ severity: rule.severity, rule: rule.id, message: rule.message, line: i + 1 });
        break; // one finding per rule is enough
      }
    }
  }

  const hasCritical = findings.some((f) => f.severity === 'critical');
  return {
    passed: !hasCritical,
    findings,
    scannedAt: new Date().toISOString(),
  };
}
