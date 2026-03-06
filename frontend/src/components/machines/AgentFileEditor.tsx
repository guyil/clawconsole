import { useState, useEffect } from 'react';
import { useFilesByMachine, useFile, useUpdateFile } from '../../hooks/useFiles';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { Save, FileText } from 'lucide-react';

interface Props {
  machineId: string;
}

export function AgentFileEditor({ machineId }: Props) {
  const { data: filesData, isLoading } = useFilesByMachine(machineId);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const { data: fileDetail } = useFile(selectedFileId ?? '');
  const updateFile = useUpdateFile();
  const [editContent, setEditContent] = useState('');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (fileDetail?.content !== undefined) {
      setEditContent(fileDetail.content ?? '');
      setDirty(false);
    }
  }, [fileDetail]);

  const files = filesData?.data ?? [];
  const managedFiles = files.filter((f) => f.fileCategory === 'console_managed');

  if (isLoading) {
    return <div className="text-claw-muted text-sm py-4">加载中...</div>;
  }

  return (
    <div className="flex gap-4 h-[500px]">
      {/* File list */}
      <div className="w-64 shrink-0 overflow-auto border border-claw-border rounded-xl bg-claw-input">
        <div className="px-3 py-2 text-xs text-claw-muted font-semibold border-b border-claw-border">
          可管理文件 ({managedFiles.length})
        </div>
        {managedFiles.map((f) => (
          <button
            key={f.id}
            onClick={() => setSelectedFileId(f.id)}
            className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 border-b border-claw-border last:border-0 cursor-pointer transition-colors
              ${selectedFileId === f.id ? 'bg-claw-primary/15 text-claw-primary-light' : 'text-claw-text hover:bg-claw-card'}`}
          >
            <FileText size={14} />
            <span className="truncate flex-1">{f.relativePath.split('/').pop()}</span>
            {f.localDirty && <Badge variant="warning">修改</Badge>}
            {f.remoteDirty && <Badge variant="info">远程</Badge>}
          </button>
        ))}
        {managedFiles.length === 0 && (
          <div className="px-3 py-4 text-xs text-claw-muted text-center">
            暂无可管理文件，请先执行同步拉取
          </div>
        )}
      </div>

      {/* Editor */}
      <div className="flex-1 flex flex-col border border-claw-border rounded-xl overflow-hidden">
        {selectedFileId && fileDetail ? (
          <>
            <div className="flex items-center justify-between px-4 py-2 bg-claw-input border-b border-claw-border">
              <div className="flex items-center gap-2">
                <span className="text-sm text-claw-text font-medium">
                  {fileDetail.relativePath}
                </span>
                <Badge variant="muted">{fileDetail.fileType}</Badge>
                {dirty && <Badge variant="warning">未保存</Badge>}
              </div>
              <Button
                size="sm"
                icon={<Save size={14} />}
                disabled={!dirty}
                loading={updateFile.isPending}
                onClick={() => {
                  updateFile.mutate(
                    { fileId: selectedFileId, content: editContent },
                    { onSuccess: () => setDirty(false) },
                  );
                }}
              >
                保存
              </Button>
            </div>
            <textarea
              className="flex-1 bg-claw-bg text-claw-text text-sm p-4 resize-none focus:outline-none font-mono"
              value={editContent}
              onChange={(e) => {
                setEditContent(e.target.value);
                setDirty(true);
              }}
              spellCheck={false}
            />
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-claw-muted text-sm">
            选择一个文件进行编辑
          </div>
        )}
      </div>
    </div>
  );
}
