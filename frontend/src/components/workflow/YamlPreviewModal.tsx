import { useState } from 'react';
import { Modal } from '../ui/Modal';
import { Copy, Check, FileCode } from 'lucide-react';

interface YamlPreviewModalProps {
  open: boolean;
  onClose: () => void;
  yaml: string;
  workflowName: string;
}

export function YamlPreviewModal({ open, onClose, yaml, workflowName }: YamlPreviewModalProps) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(yaml);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Modal open={open} onClose={onClose} title="YAML 预览" width="max-w-2xl">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-sm text-claw-muted">
          <FileCode size={14} className="text-claw-primary-light" />
          <span>{workflowName}.yaml</span>
        </div>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 text-xs text-claw-muted hover:text-claw-text transition-colors cursor-pointer"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <pre className="bg-claw-bg border border-claw-border rounded-xl p-4 text-sm text-claw-text font-mono overflow-auto max-h-[500px] whitespace-pre-wrap leading-relaxed">
        {yaml}
      </pre>
    </Modal>
  );
}
