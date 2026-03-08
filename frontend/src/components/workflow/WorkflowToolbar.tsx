import {
  Save,
  ShieldCheck,
  Rocket,
  FileCode,
  History,
  AlertTriangle,
  CheckCircle,
  Loader2,
} from 'lucide-react';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import type { WorkflowStatus, ValidationResult } from '../../types/workflow';

const statusConfig: Record<WorkflowStatus, { label: string; variant: 'success' | 'warning' | 'danger' | 'muted' | 'info' }> = {
  draft: { label: '草稿', variant: 'muted' },
  active: { label: '运行中', variant: 'success' },
  disabled: { label: '已禁用', variant: 'warning' },
  archived: { label: '已归档', variant: 'muted' },
};

interface WorkflowToolbarProps {
  name: string;
  status: WorkflowStatus;
  onSave: () => void;
  onValidate: () => void;
  onDeploy: () => void;
  onYaml: () => void;
  onVersions: () => void;
  saving?: boolean;
  validating?: boolean;
  validation?: ValidationResult | null;
  hasChanges?: boolean;
}

export function WorkflowToolbar({
  name,
  status,
  onSave,
  onValidate,
  onDeploy,
  onYaml,
  onVersions,
  saving,
  validating,
  validation,
  hasChanges,
}: WorkflowToolbarProps) {
  const statusCfg = statusConfig[status];

  return (
    <div className="flex items-center justify-between px-5 py-3 bg-claw-sidebar border-b border-claw-border">
      <div className="flex items-center gap-3">
        <h2 className="text-base font-bold text-claw-text truncate max-w-[260px]">{name}</h2>
        <Badge variant={statusCfg.variant}>{statusCfg.label}</Badge>
        {hasChanges && (
          <span className="text-[10px] text-claw-warning bg-claw-warning/10 px-2 py-0.5 rounded-full">
            未保存
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        {/* Validation result indicator */}
        {validation && (
          <div className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded-full ${
            validation.valid
              ? 'bg-claw-success/10 text-claw-success'
              : 'bg-claw-danger/10 text-claw-danger'
          }`}>
            {validation.valid ? <CheckCircle size={12} /> : <AlertTriangle size={12} />}
            {validation.valid
              ? '校验通过'
              : `${validation.errors.length} 个错误`}
          </div>
        )}

        <Button
          variant="secondary"
          size="sm"
          icon={<History size={14} />}
          onClick={onVersions}
        >
          版本
        </Button>

        <Button
          variant="secondary"
          size="sm"
          icon={<FileCode size={14} />}
          onClick={onYaml}
        >
          YAML
        </Button>

        <Button
          variant="secondary"
          size="sm"
          icon={validating ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
          onClick={onValidate}
          disabled={validating}
        >
          校验
        </Button>

        <Button
          variant="secondary"
          size="sm"
          icon={<Save size={14} />}
          onClick={onSave}
          loading={saving}
        >
          保存
        </Button>

        <Button
          size="sm"
          icon={<Rocket size={14} />}
          onClick={onDeploy}
        >
          部署
        </Button>
      </div>
    </div>
  );
}
