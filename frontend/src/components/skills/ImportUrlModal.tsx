import { useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { useImportSkillFromUrl } from '../../hooks/useSkills';
import { Link2, ExternalLink } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
}

const SUPPORTED_SOURCES = [
  { name: 'ClawHub', url: 'https://clawhub.ai', color: 'text-orange-400' },
  { name: 'SkillsMP', url: 'https://skillsmp.com', color: 'text-blue-400' },
  { name: 'GitHub', url: 'https://github.com', color: 'text-gray-300' },
];

export function ImportUrlModal({ open, onClose }: Props) {
  const importSkill = useImportSkillFromUrl();
  const [url, setUrl] = useState('');

  const handleSubmit = () => {
    if (!url.trim()) return;
    importSkill.mutate(url.trim(), {
      onSuccess: () => {
        onClose();
        setUrl('');
      },
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && url.trim()) handleSubmit();
  };

  const inputClass =
    'w-full bg-claw-input border border-claw-border rounded-lg px-3 py-2.5 text-sm text-claw-text placeholder-claw-muted focus:outline-none focus:border-claw-primary';

  return (
    <Modal open={open} onClose={onClose} title="从 URL 导入 Skill" width="max-w-lg">
      <div className="space-y-4">
        <div>
          <label className="block text-xs text-claw-muted mb-1.5">
            粘贴 Skill 链接
          </label>
          <div className="relative">
            <Link2 size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-claw-muted" />
            <input
              className={`${inputClass} pl-9`}
              placeholder="https://clawhub.ai/skills/... 或 https://skillsmp.com/skills/..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={handleKeyDown}
              autoFocus
            />
          </div>
        </div>

        <div className="bg-claw-input/50 rounded-lg p-3 border border-claw-border">
          <div className="text-xs text-claw-muted mb-2">支持的来源</div>
          <div className="flex gap-3 flex-wrap">
            {SUPPORTED_SOURCES.map((s) => (
              <a
                key={s.name}
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                className={`inline-flex items-center gap-1 text-xs ${s.color} hover:underline`}
              >
                {s.name}
                <ExternalLink size={10} />
              </a>
            ))}
          </div>
          <div className="text-[11px] text-claw-muted mt-2">
            也支持直接粘贴 SKILL.md 原始内容的 URL（如 GitHub raw 链接）
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-1">
          <Button variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button
            onClick={handleSubmit}
            loading={importSkill.isPending}
            disabled={!url.trim()}
          >
            导入
          </Button>
        </div>
      </div>
    </Modal>
  );
}
