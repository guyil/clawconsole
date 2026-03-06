import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Pencil, Trash2, Upload } from 'lucide-react';
import type { Credential } from '../../types/credential';

interface Props {
  credential: Credential;
  machineName?: string;
  onEdit: () => void;
  onDelete: () => void;
  onSync: () => void;
  syncLoading?: boolean;
}

const typeLabels: Record<string, string> = {
  api_key: 'API Key',
  oauth_token: 'OAuth',
  allow_from: 'Allow',
  pairing: 'Pairing',
  webhook_secret: 'Webhook',
  other: '其他',
};

export function CredentialCard({
  credential,
  machineName,
  onEdit,
  onDelete,
  onSync,
  syncLoading,
}: Props) {
  return (
    <Card>
      <div className="flex justify-between items-start mb-3">
        <div>
          <div className="text-[15px] font-semibold text-claw-text">{credential.name}</div>
          {credential.provider && (
            <div className="text-xs text-claw-muted mt-0.5">{credential.provider}</div>
          )}
        </div>
        <Badge variant="info">{typeLabels[credential.credentialType] ?? credential.credentialType}</Badge>
      </div>

      <div className="flex gap-3 mb-3">
        <div className="flex-1 py-2 px-3 bg-claw-input rounded-lg text-center">
          <div className="text-[11px] text-claw-muted">节点</div>
          <div className="text-xs text-claw-text font-medium mt-0.5 truncate">
            {machineName ?? '全局'}
          </div>
        </div>
        <div className="flex-1 py-2 px-3 bg-claw-input rounded-lg text-center">
          <div className="text-[11px] text-claw-muted">目标文件</div>
          <div className="text-xs text-claw-text font-medium mt-0.5 truncate">
            {credential.targetFilePath ?? '-'}
          </div>
        </div>
      </div>

      {credential.description && (
        <p className="text-xs text-claw-muted mb-3 line-clamp-2">{credential.description}</p>
      )}

      <div className="flex gap-2">
        {credential.machineId && (
          <Button
            variant="secondary"
            size="sm"
            icon={<Upload size={14} />}
            onClick={onSync}
            loading={syncLoading}
            className="flex-1"
          >
            同步到节点
          </Button>
        )}
        <Button variant="ghost" size="sm" icon={<Pencil size={14} />} onClick={onEdit} />
        <Button
          variant="ghost"
          size="sm"
          icon={<Trash2 size={14} />}
          onClick={onDelete}
          className="text-claw-danger hover:bg-claw-danger/10"
        />
      </div>
    </Card>
  );
}
