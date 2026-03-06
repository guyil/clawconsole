import { useState, useCallback } from 'react';
import { FileCode, FolderOpen, Plus, Trash2, ChevronRight, ChevronDown } from 'lucide-react';
import type { SkillFileMap } from '../../types/playground';

interface SkillFileTreeProps {
  files: SkillFileMap;
  activeFile: string;
  onSelectFile: (path: string) => void;
  onAddFile: (path: string) => void;
  onDeleteFile: (path: string) => void;
  readOnly?: boolean;
}

interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children: TreeNode[];
}

function buildTree(files: SkillFileMap): TreeNode[] {
  const root: TreeNode[] = [];

  for (const filePath of Object.keys(files).sort()) {
    const parts = filePath.split('/');
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      const isLast = i === parts.length - 1;
      const partPath = parts.slice(0, i + 1).join('/');

      let node = current.find((n) => n.name === name);
      if (!node) {
        node = { name, path: partPath, isDir: !isLast, children: [] };
        current.push(node);
      }
      current = node.children;
    }
  }

  return root;
}

function getFileIcon(name: string) {
  if (name === 'SKILL.md') return '📋';
  if (name.endsWith('.md')) return '📝';
  if (name.endsWith('.py')) return '🐍';
  if (name.endsWith('.ts') || name.endsWith('.js')) return '📜';
  if (name.endsWith('.json')) return '📦';
  if (name.endsWith('.yaml') || name.endsWith('.yml')) return '⚙️';
  return '📄';
}

function TreeItem({
  node,
  activeFile,
  depth,
  onSelectFile,
  onDeleteFile,
  readOnly,
}: {
  node: TreeNode;
  activeFile: string;
  depth: number;
  onSelectFile: (path: string) => void;
  onDeleteFile: (path: string) => void;
  readOnly?: boolean;
}) {
  const [expanded, setExpanded] = useState(true);
  const isActive = node.path === activeFile;
  const isProtected = node.path === 'SKILL.md';

  if (node.isDir) {
    return (
      <div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1.5 w-full px-2 py-1 text-xs text-claw-muted hover:text-claw-text hover:bg-claw-card/50 rounded transition-colors"
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <FolderOpen size={13} className="text-claw-warning" />
          <span className="truncate">{node.name}</span>
        </button>
        {expanded && node.children.map((child) => (
          <TreeItem
            key={child.path}
            node={child}
            activeFile={activeFile}
            depth={depth + 1}
            onSelectFile={onSelectFile}
            onDeleteFile={onDeleteFile}
            readOnly={readOnly}
          />
        ))}
      </div>
    );
  }

  return (
    <button
      onClick={() => onSelectFile(node.path)}
      className={`group flex items-center gap-1.5 w-full px-2 py-1 text-xs rounded transition-colors ${
        isActive
          ? 'bg-claw-primary/20 text-claw-primary-light'
          : 'text-claw-text hover:bg-claw-card/50'
      }`}
      style={{ paddingLeft: `${depth * 12 + 8}px` }}
    >
      <span className="text-[11px]">{getFileIcon(node.name)}</span>
      <span className="truncate flex-1 text-left">{node.name}</span>
      {!isProtected && !readOnly && (
        <span
          onClick={(e) => { e.stopPropagation(); onDeleteFile(node.path); }}
          className="opacity-0 group-hover:opacity-100 p-0.5 text-claw-muted hover:text-claw-danger transition-all"
        >
          <Trash2 size={11} />
        </span>
      )}
    </button>
  );
}

export function SkillFileTree({
  files,
  activeFile,
  onSelectFile,
  onAddFile,
  onDeleteFile,
  readOnly,
}: SkillFileTreeProps) {
  const [showNewFile, setShowNewFile] = useState(false);
  const [newFileName, setNewFileName] = useState('');

  const tree = buildTree(files);

  const handleAddFile = useCallback(() => {
    const name = newFileName.trim();
    if (!name) return;
    onAddFile(name);
    setNewFileName('');
    setShowNewFile(false);
  }, [newFileName, onAddFile]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-claw-border">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-claw-muted">Files</span>
        {!readOnly && (
          <button
            onClick={() => setShowNewFile(!showNewFile)}
            className="p-0.5 text-claw-muted hover:text-claw-text transition-colors"
            title="Add file"
          >
            <Plus size={13} />
          </button>
        )}
      </div>

      {showNewFile && (
        <div className="px-2 py-1.5 border-b border-claw-border">
          <input
            value={newFileName}
            onChange={(e) => setNewFileName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAddFile();
              if (e.key === 'Escape') { setShowNewFile(false); setNewFileName(''); }
            }}
            placeholder="e.g. reference.md"
            className="w-full bg-claw-bg border border-claw-border rounded px-2 py-1 text-xs text-claw-text placeholder-claw-muted focus:border-claw-primary focus:outline-none"
            autoFocus
          />
        </div>
      )}

      <div className="flex-1 overflow-y-auto py-1">
        {tree.map((node) => (
          <TreeItem
            key={node.path}
            node={node}
            activeFile={activeFile}
            depth={0}
            onSelectFile={onSelectFile}
            onDeleteFile={onDeleteFile}
            readOnly={readOnly}
          />
        ))}
      </div>
    </div>
  );
}
