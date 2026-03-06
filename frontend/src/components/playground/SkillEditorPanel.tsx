import { useState, useCallback } from 'react';
import Editor from '@monaco-editor/react';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { ShieldCheck, CheckCircle, AlertTriangle, FileCode, Settings2 } from 'lucide-react';
import type { ValidateSkillResult, SecurityScanResult, SkillFileMap } from '../../types/playground';
import { SkillFrontmatterForm } from './SkillFrontmatterForm';
import { SecurityScanResults } from './SecurityScanResults';
import { SkillFileTree } from './SkillFileTree';

interface SkillEditorPanelProps {
  skillFiles: SkillFileMap;
  activeFilePath: string;
  onSelectFile: (path: string) => void;
  onFileChange: (path: string, content: string) => void;
  onAddFile: (path: string) => void;
  onDeleteFile: (path: string) => void;
  onValidate: () => void;
  onScan: () => void;
  validationResult: ValidateSkillResult | null;
  scanResult: SecurityScanResult | null;
  validating: boolean;
  scanning: boolean;
  hasSession: boolean;
}

type EditorTab = 'source' | 'frontmatter';

function getLanguage(filePath: string): string {
  if (filePath.endsWith('.md')) return 'markdown';
  if (filePath.endsWith('.py')) return 'python';
  if (filePath.endsWith('.ts')) return 'typescript';
  if (filePath.endsWith('.js')) return 'javascript';
  if (filePath.endsWith('.json')) return 'json';
  if (filePath.endsWith('.yaml') || filePath.endsWith('.yml')) return 'yaml';
  if (filePath.endsWith('.sh')) return 'shell';
  return 'plaintext';
}

export function SkillEditorPanel({
  skillFiles,
  activeFilePath,
  onSelectFile,
  onFileChange,
  onAddFile,
  onDeleteFile,
  onValidate,
  onScan,
  validationResult,
  scanResult,
  validating,
  scanning,
  hasSession,
}: SkillEditorPanelProps) {
  const [editorTab, setEditorTab] = useState<EditorTab>('source');
  const activeContent = skillFiles[activeFilePath] ?? '';
  const isSkillMd = activeFilePath === 'SKILL.md';

  const handleEditorChange = useCallback((val: string | undefined) => {
    onFileChange(activeFilePath, val ?? '');
  }, [activeFilePath, onFileChange]);

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-claw-border bg-claw-sidebar/50">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setEditorTab('source')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
              editorTab === 'source'
                ? 'bg-claw-primary/20 text-claw-primary-light'
                : 'text-claw-muted hover:text-claw-text'
            }`}
          >
            <FileCode size={13} />
            {activeFilePath}
          </button>
          {isSkillMd && (
            <button
              onClick={() => setEditorTab('frontmatter')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                editorTab === 'frontmatter'
                  ? 'bg-claw-primary/20 text-claw-primary-light'
                  : 'text-claw-muted hover:text-claw-text'
              }`}
            >
              <Settings2 size={13} />
              Frontmatter
            </button>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {validationResult && (
            <Badge variant={validationResult.valid ? 'success' : 'danger'}>
              {validationResult.valid ? (
                <><CheckCircle size={11} className="mr-1" /> Valid</>
              ) : (
                <><AlertTriangle size={11} className="mr-1" /> {validationResult.errors.length} err</>
              )}
            </Badge>
          )}
          <Button size="sm" variant="ghost" onClick={onValidate} loading={validating}>
            <CheckCircle size={13} />
          </Button>
          <Button size="sm" variant="ghost" onClick={onScan} loading={scanning}>
            <ShieldCheck size={13} />
          </Button>
        </div>
      </div>

      {/* Content area: file tree + editor */}
      <div className="flex flex-1 min-h-0">
        {/* File tree sidebar */}
        {hasSession && (
          <div className="w-40 min-w-[140px] border-r border-claw-border bg-claw-sidebar/30 flex-shrink-0">
            <SkillFileTree
              files={skillFiles}
              activeFile={activeFilePath}
              onSelectFile={onSelectFile}
              onAddFile={onAddFile}
              onDeleteFile={onDeleteFile}
            />
          </div>
        )}

        {/* Editor */}
        <div className="flex-1 min-w-0">
          {editorTab === 'source' || !isSkillMd ? (
            <Editor
              height="100%"
              language={getLanguage(activeFilePath)}
              theme="vs-dark"
              value={activeContent}
              onChange={handleEditorChange}
              options={{
                minimap: { enabled: false },
                fontSize: 13,
                lineNumbers: 'on',
                wordWrap: 'on',
                scrollBeyondLastLine: false,
                padding: { top: 12 },
              }}
            />
          ) : (
            <SkillFrontmatterForm
              value={activeContent}
              onChange={(val) => onFileChange('SKILL.md', val)}
            />
          )}
        </div>
      </div>

      {/* Scan Results */}
      {scanResult && <SecurityScanResults result={scanResult} />}
    </div>
  );
}
