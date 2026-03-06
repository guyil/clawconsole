import { useMemo, useCallback } from 'react';

interface SkillFrontmatterFormProps {
  value: string;
  onChange: (value: string) => void;
}

interface FormData {
  name: string;
  description: string;
  allowedTools: string;
  disableModelInvocation: boolean;
  userInvocable: boolean;
  context: string;
  agent: string;
  model: string;
  argumentHint: string;
}

const FRONTMATTER_REGEX = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;

function parseFrontmatterValues(raw: string): { formData: FormData; bodyContent: string } {
  const match = FRONTMATTER_REGEX.exec(raw);
  const defaults: FormData = {
    name: '', description: '', allowedTools: '',
    disableModelInvocation: false, userInvocable: true,
    context: '', agent: '', model: '', argumentHint: '',
  };

  if (!match) return { formData: defaults, bodyContent: raw };

  const fmBlock = match[1];
  const body = match[2];

  const lines = fmBlock.split('\n');
  for (const line of lines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx < 0) continue;
    const key = line.slice(0, colonIdx).trim();
    const val = line.slice(colonIdx + 1).trim();

    switch (key) {
      case 'name': defaults.name = val; break;
      case 'description': defaults.description = val; break;
      case 'allowed-tools': defaults.allowedTools = val; break;
      case 'disable-model-invocation': defaults.disableModelInvocation = val === 'true'; break;
      case 'user-invocable': defaults.userInvocable = val !== 'false'; break;
      case 'context': defaults.context = val; break;
      case 'agent': defaults.agent = val; break;
      case 'model': defaults.model = val; break;
      case 'argument-hint': defaults.argumentHint = val; break;
    }
  }

  return { formData: defaults, bodyContent: body };
}

function rebuildSkillMd(formData: FormData, bodyContent: string): string {
  const fmLines: string[] = [];
  if (formData.name) fmLines.push(`name: ${formData.name}`);
  if (formData.description) fmLines.push(`description: ${formData.description}`);
  if (formData.allowedTools) fmLines.push(`allowed-tools: ${formData.allowedTools}`);
  if (formData.disableModelInvocation) fmLines.push('disable-model-invocation: true');
  if (!formData.userInvocable) fmLines.push('user-invocable: false');
  if (formData.context) fmLines.push(`context: ${formData.context}`);
  if (formData.agent) fmLines.push(`agent: ${formData.agent}`);
  if (formData.model) fmLines.push(`model: ${formData.model}`);
  if (formData.argumentHint) fmLines.push(`argument-hint: ${formData.argumentHint}`);

  if (fmLines.length === 0) return bodyContent;
  return `---\n${fmLines.join('\n')}\n---\n${bodyContent}`;
}

export function SkillFrontmatterForm({ value, onChange }: SkillFrontmatterFormProps) {
  const { formData, bodyContent } = useMemo(() => parseFrontmatterValues(value), [value]);

  const update = useCallback(
    (field: keyof FormData, val: string | boolean) => {
      const updated = { ...formData, [field]: val };
      onChange(rebuildSkillMd(updated, bodyContent));
    },
    [formData, bodyContent, onChange],
  );

  const inputClass =
    'w-full bg-claw-bg border border-claw-border rounded-lg px-3 py-2 text-sm text-claw-text focus:border-claw-primary focus:outline-none';
  const labelClass = 'block text-xs font-medium text-claw-muted mb-1';

  return (
    <div className="p-4 space-y-4 overflow-y-auto h-full">
      <div>
        <label className={labelClass}>Name</label>
        <input className={inputClass} value={formData.name} onChange={(e) => update('name', e.target.value)} placeholder="my-skill" />
        <p className="text-[11px] text-claw-muted mt-1">Lowercase letters, numbers, and hyphens only</p>
      </div>

      <div>
        <label className={labelClass}>Description</label>
        <textarea
          className={`${inputClass} resize-none`}
          rows={3}
          value={formData.description}
          onChange={(e) => update('description', e.target.value)}
          placeholder="Describe what this skill does and when it should be used..."
        />
      </div>

      <div>
        <label className={labelClass}>Allowed Tools</label>
        <input className={inputClass} value={formData.allowedTools} onChange={(e) => update('allowedTools', e.target.value)} placeholder="read_file, write_file, search" />
        <p className="text-[11px] text-claw-muted mt-1">Comma-separated list of tool names</p>
      </div>

      <div>
        <label className={labelClass}>Model</label>
        <input className={inputClass} value={formData.model} onChange={(e) => update('model', e.target.value)} placeholder="claude-sonnet-4-20250514" />
      </div>

      <div>
        <label className={labelClass}>Argument Hint</label>
        <input className={inputClass} value={formData.argumentHint} onChange={(e) => update('argumentHint', e.target.value)} placeholder="[filename] [format]" />
      </div>

      <div>
        <label className={labelClass}>Context</label>
        <select className={inputClass} value={formData.context} onChange={(e) => update('context', e.target.value)}>
          <option value="">Default (inline)</option>
          <option value="fork">Fork (isolated subagent)</option>
        </select>
      </div>

      <div>
        <label className={labelClass}>Agent</label>
        <input className={inputClass} value={formData.agent} onChange={(e) => update('agent', e.target.value)} placeholder="Explore, Plan, general-purpose" />
      </div>

      <div className="flex items-center gap-6">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={formData.disableModelInvocation}
            onChange={(e) => update('disableModelInvocation', e.target.checked)}
            className="accent-claw-primary"
          />
          <span className="text-sm text-claw-text">Disable model invocation</span>
        </label>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={formData.userInvocable}
            onChange={(e) => update('userInvocable', e.target.checked)}
            className="accent-claw-primary"
          />
          <span className="text-sm text-claw-text">User invocable</span>
        </label>
      </div>
    </div>
  );
}
