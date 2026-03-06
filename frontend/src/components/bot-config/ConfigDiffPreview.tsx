import { FileText, Upload, AlertCircle, CheckCircle } from 'lucide-react';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { Spinner } from '../ui/Spinner';
import { usePendingChanges, useSyncConfig } from '../../hooks/useBotConfigAgent';
import { useState } from 'react';
import type { PendingChange } from '../../api/bot-config-agent.api';

interface ConfigDiffPreviewProps {
  agentId: string;
}

export function ConfigDiffPreview({ agentId }: ConfigDiffPreviewProps) {
  const { data: changesData, isLoading } = usePendingChanges(agentId);
  const syncMutation = useSyncConfig(agentId);
  const [expandedFile, setExpandedFile] = useState<string | null>(null);

  const changes: PendingChange[] = changesData?.data ?? [];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-claw-muted text-sm gap-2">
        <Spinner size={16} />
        加载变更...
      </div>
    );
  }

  if (changes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-6">
        <div className="w-12 h-12 rounded-2xl bg-claw-primary/10 flex items-center justify-center mb-3">
          <CheckCircle size={24} className="text-claw-primary-light" />
        </div>
        <p className="text-sm text-claw-muted">
          暂无待同步的变更
        </p>
        <p className="text-xs text-claw-muted mt-1">
          通过左侧 AI 对话修改配置后，变更将显示在这里
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2 border-b border-claw-border bg-claw-sidebar/50">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-claw-text">待同步变更</span>
          <Badge variant="warning">{changes.length} 个文件</Badge>
        </div>
        <Button
          size="sm"
          variant="primary"
          onClick={() => syncMutation.mutate()}
          loading={syncMutation.isPending}
          icon={<Upload size={12} />}
        >
          同步全部
        </Button>
      </div>

      {syncMutation.isError && (
        <div className="px-4 py-2 bg-claw-danger/10 border-b border-claw-danger/20 flex items-center gap-2 text-sm text-claw-danger">
          <AlertCircle size={14} />
          同步失败，请重试
        </div>
      )}

      {syncMutation.isSuccess && syncMutation.data.syncedFiles > 0 && (
        <div className="px-4 py-2 bg-green-500/10 border-b border-green-500/20 flex items-center gap-2 text-sm text-green-400">
          <CheckCircle size={14} />
          已成功同步 {syncMutation.data.syncedFiles} 个文件
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {changes.map((change) => {
          const isExpanded = expandedFile === change.filename;
          return (
            <div key={change.filename} className="border-b border-claw-border">
              <button
                onClick={() => setExpandedFile(isExpanded ? null : change.filename)}
                className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-claw-card/50 transition-colors cursor-pointer"
              >
                <FileText size={14} className="text-claw-primary-light shrink-0" />
                <span className="text-sm font-medium text-claw-text flex-1">{change.filename}</span>
                <Badge variant="warning">已修改</Badge>
              </button>

              {isExpanded && (
                <div className="px-4 pb-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <div className="text-xs text-claw-muted mb-1 font-medium">原始内容</div>
                      <pre className="bg-claw-bg border border-claw-border rounded-lg p-3 text-xs text-claw-muted font-mono whitespace-pre-wrap max-h-60 overflow-y-auto">
                        {change.originalContent || '(空文件)'}
                      </pre>
                    </div>
                    <div>
                      <div className="text-xs text-green-400 mb-1 font-medium">修改后内容</div>
                      <pre className="bg-claw-bg border border-green-500/20 rounded-lg p-3 text-xs text-claw-text font-mono whitespace-pre-wrap max-h-60 overflow-y-auto">
                        {change.currentContent}
                      </pre>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
