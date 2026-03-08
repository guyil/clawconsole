import { useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { useImportSkillFromLocal } from '../../hooks/useSkills';
import { FolderOpen, Info } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function ImportLocalModal({ open, onClose }: Props) {
  const importSkill = useImportSkillFromLocal();
  const [folderPath, setFolderPath] = useState('');

  const handleSubmit = () => {
    if (!folderPath.trim()) return;
    importSkill.mutate(folderPath.trim(), {
      onSuccess: () => {
        onClose();
        setFolderPath('');
      },
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && folderPath.trim()) handleSubmit();
  };

  const inputClass =
    'w-full bg-claw-input border border-claw-border rounded-lg px-3 py-2.5 text-sm text-claw-text placeholder-claw-muted focus:outline-none focus:border-claw-primary';

  return (
    <Modal open={open} onClose={onClose} title="从本地文件夹导入 Skill" width="max-w-lg">
      <div className="space-y-4">
        <div>
          <label className="block text-xs text-claw-muted mb-1.5">
            本地文件夹路径
          </label>
          <div className="relative">
            <FolderOpen size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-claw-muted" />
            <input
              className={`${inputClass} pl-9 font-mono`}
              placeholder="/path/to/skill-folder"
              value={folderPath}
              onChange={(e) => setFolderPath(e.target.value)}
              onKeyDown={handleKeyDown}
              autoFocus
            />
          </div>
        </div>

        <div className="bg-claw-input/50 rounded-lg p-3 border border-claw-border">
          <div className="flex items-start gap-2">
            <Info size={14} className="text-claw-muted mt-0.5 shrink-0" />
            <div className="text-[11px] text-claw-muted space-y-1">
              <p>文件夹需包含 <code className="text-claw-text bg-claw-bg px-1 rounded">SKILL.md</code> 文件。</p>
              <p>文件夹中的其他文本文件将作为辅助文件一并导入。</p>
              <p>导入后 Skill 会关联该路径，后续可随时同步最新内容。</p>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-1">
          <Button variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button
            onClick={handleSubmit}
            loading={importSkill.isPending}
            disabled={!folderPath.trim()}
          >
            导入
          </Button>
        </div>
      </div>
    </Modal>
  );
}
