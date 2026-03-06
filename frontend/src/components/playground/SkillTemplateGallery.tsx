import { Modal } from '../ui/Modal';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { usePlaygroundTemplates } from '../../hooks/usePlayground';
import { Spinner } from '../ui/Spinner';

interface SkillTemplateGalleryProps {
  open: boolean;
  onClose: () => void;
  onSelect: (content: string) => void;
}

export function SkillTemplateGallery({ open, onClose, onSelect }: SkillTemplateGalleryProps) {
  const { data, isLoading } = usePlaygroundTemplates();

  const templates = data?.data ?? [];

  return (
    <Modal open={open} onClose={onClose} title="Skill Templates" width="max-w-2xl">
      {isLoading ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : (
        <div className="space-y-3 max-h-[60vh] overflow-y-auto">
          {templates.map((tmpl) => (
            <Card key={tmpl.id} hover className="group">
              <div className="flex items-start justify-between">
                <div>
                  <h4 className="text-sm font-semibold text-claw-text">{tmpl.name}</h4>
                  <p className="text-xs text-claw-muted mt-1">{tmpl.description}</p>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => { onSelect(tmpl.content); onClose(); }}
                >
                  Use
                </Button>
              </div>
              <pre className="mt-3 text-[11px] text-claw-muted bg-claw-bg rounded-lg p-3 max-h-32 overflow-hidden">
                {tmpl.content.slice(0, 300)}
                {tmpl.content.length > 300 && '...'}
              </pre>
            </Card>
          ))}
        </div>
      )}
    </Modal>
  );
}
