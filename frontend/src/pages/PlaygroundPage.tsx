import { useState, useCallback, useEffect, useRef } from 'react';
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import {
  Play,
  BookTemplate,
  History,
  Save,
  Download,
  ChevronDown,
  Bot,
  X,
} from 'lucide-react';
import { SkillEditorPanel } from '../components/playground/SkillEditorPanel';
import { SkillOptimizerPanel } from '../components/playground/SkillOptimizerPanel';
import { SkillChatPanel } from '../components/playground/SkillChatPanel';
import { SkillTemplateGallery } from '../components/playground/SkillTemplateGallery';
import { SessionHistoryPanel } from '../components/playground/SessionHistoryPanel';
import { Modal } from '../components/ui/Modal';
import {
  useCreatePlaygroundSession,
  usePlaygroundSessions,
  useDeletePlaygroundSession,
  useStopPlaygroundSession,
  useValidateSkill,
  useScanSkill,
  useSkillFiles,
  useUpdateSkillFile,
  useDeleteSkillFile,
} from '../hooks/usePlayground';
import { useSkills } from '../hooks/useSkills';
import { useAllAgents } from '../hooks/useAgents';
import { agentsApi } from '../api/agents.api';
import type { PlaygroundSession, ValidateSkillResult, SecurityScanResult, BotIdentityFile, SkillFileMap } from '../types/playground';
import toast from 'react-hot-toast';

const DEFAULT_SKILL = `---
name: my-skill
description: A helpful skill that assists with a specific task
---

When helping the user:

1. Understand the request clearly
2. Break down the task into steps
3. Execute each step carefully
4. Summarize the results
`;

export function PlaygroundPage() {
  const [localSkillFiles, setLocalSkillFiles] = useState<SkillFileMap>({ 'SKILL.md': DEFAULT_SKILL });
  const [activeFilePath, setActiveFilePath] = useState('SKILL.md');
  const [activeSession, setActiveSession] = useState<PlaygroundSession | null>(null);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showSkillPicker, setShowSkillPicker] = useState(false);
  const [showBotPicker, setShowBotPicker] = useState(false);
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null);
  const [validationResult, setValidationResult] = useState<ValidateSkillResult | null>(null);
  const [scanResult, setScanResult] = useState<SecurityScanResult | null>(null);

  const createSession = useCreatePlaygroundSession();
  const { data: sessionsData } = usePlaygroundSessions();
  const deleteSession = useDeletePlaygroundSession();
  const stopSession = useStopPlaygroundSession();
  const validateMutation = useValidateSkill();
  const scanMutation = useScanSkill();
  const { data: skillsData } = useSkills();
  const { data: agentsData } = useAllAgents();
  const { data: remoteFilesData } = useSkillFiles(activeSession?.id ?? null);
  const updateSkillFileMutation = useUpdateSkillFile();
  const deleteSkillFileMutation = useDeleteSkillFile();

  const sessions = sessionsData?.data ?? [];
  const skills = skillsData?.data ?? [];
  const agents = agentsData?.data ?? [];
  const selectedBot = agents.find((a) => a.id === selectedBotId);

  // Sync remote skill files from optimizer's changes into local state
  const lastSyncRef = useRef<string>('');
  useEffect(() => {
    if (!remoteFilesData?.data || !activeSession) return;
    const remoteMap: SkillFileMap = {};
    for (const f of remoteFilesData.data) {
      remoteMap[f.path] = f.content;
    }
    const remoteKey = JSON.stringify(remoteMap);
    if (remoteKey !== lastSyncRef.current) {
      lastSyncRef.current = remoteKey;
      setLocalSkillFiles(remoteMap);
    }
  }, [remoteFilesData, activeSession]);

  const handleFileChange = useCallback((filePath: string, content: string) => {
    setLocalSkillFiles((prev) => ({ ...prev, [filePath]: content }));
    if (activeSession) {
      updateSkillFileMutation.mutate({
        sessionId: activeSession.id,
        filePath,
        content,
      });
    }
  }, [activeSession, updateSkillFileMutation]);

  const handleAddFile = useCallback((filePath: string) => {
    const defaultContent = filePath.endsWith('.md')
      ? `# ${filePath.replace(/\.md$/, '')}\n\n`
      : '';
    setLocalSkillFiles((prev) => ({ ...prev, [filePath]: defaultContent }));
    setActiveFilePath(filePath);
    if (activeSession) {
      updateSkillFileMutation.mutate({
        sessionId: activeSession.id,
        filePath,
        content: defaultContent,
      });
    }
  }, [activeSession, updateSkillFileMutation]);

  const handleDeleteFile = useCallback((filePath: string) => {
    if (filePath === 'SKILL.md') return;
    setLocalSkillFiles((prev) => {
      const next = { ...prev };
      delete next[filePath];
      return next;
    });
    if (activeFilePath === filePath) setActiveFilePath('SKILL.md');
    if (activeSession) {
      deleteSkillFileMutation.mutate({ sessionId: activeSession.id, filePath });
    }
  }, [activeSession, activeFilePath, deleteSkillFileMutation]);

  const handleStartSession = useCallback(async () => {
    try {
      const skillMdContent = localSkillFiles['SKILL.md'] ?? DEFAULT_SKILL;

      // Fetch identity files on-demand to avoid holding SSH connections
      let identityFiles: BotIdentityFile[] = [];
      if (selectedBotId) {
        try {
          const resp = await agentsApi.getConfigFiles(selectedBotId);
          identityFiles = (resp.data ?? []).map((f) => ({ filename: f.filename, content: f.content }));
        } catch (err) {
          toast.error('Failed to load bot identity files — starting without bot identity');
        }
      }

      const session = await createSession.mutateAsync({
        skillCatalogId: selectedSkillId ?? undefined,
        skillMdContent,
        agentId: selectedBotId ?? undefined,
        identityFiles: identityFiles.length > 0 ? identityFiles : undefined,
      });
      setActiveSession(session);
      const botInfo = selectedBot ? ` as ${selectedBot.name ?? selectedBot.agentId}` : '';
      toast.success(`Session started${botInfo}`);
    } catch {
      // handled by API interceptor
    }
  }, [createSession, localSkillFiles, selectedSkillId, selectedBotId, selectedBot]);

  const handleStopSession = useCallback(async () => {
    if (!activeSession) return;
    await stopSession.mutateAsync(activeSession.id);
    setActiveSession((prev) => prev ? { ...prev, status: 'completed' } : null);
    toast.success('Session stopped');
  }, [activeSession, stopSession]);

  const handleNewSession = useCallback(() => {
    setActiveSession(null);
    lastSyncRef.current = '';
  }, []);

  const handleValidate = useCallback(async () => {
    const content = localSkillFiles['SKILL.md'] ?? '';
    const result = await validateMutation.mutateAsync(content);
    setValidationResult(result);
    if (result.valid) toast.success('Skill is valid');
    else toast.error(`Validation failed: ${result.errors.length} errors`);
  }, [validateMutation, localSkillFiles]);

  const handleScan = useCallback(async () => {
    const content = localSkillFiles['SKILL.md'] ?? '';
    const result = await scanMutation.mutateAsync(content);
    setScanResult(result);
    if (result.passed) toast.success('Security scan passed');
    else toast.error('Security scan found issues');
  }, [scanMutation, localSkillFiles]);

  const handleSelectTemplate = useCallback((content: string) => {
    setLocalSkillFiles({ 'SKILL.md': content });
    setActiveFilePath('SKILL.md');
    setValidationResult(null);
    setScanResult(null);
  }, []);

  const handleSelectSkill = useCallback((skillId: string) => {
    const skill = skills.find((s) => s.id === skillId);
    if (skill?.skillMdContent) {
      setLocalSkillFiles({ 'SKILL.md': skill.skillMdContent });
      setSelectedSkillId(skillId);
      setActiveFilePath('SKILL.md');
      setValidationResult(null);
      setScanResult(null);
    }
    setShowSkillPicker(false);
  }, [skills]);

  const handleSelectBot = useCallback((agentId: string) => {
    setSelectedBotId(agentId);
    setShowBotPicker(false);
    const bot = agents.find((a) => a.id === agentId);
    toast.success(`Bot selected: ${bot?.name ?? bot?.agentId ?? agentId}`);
  }, [agents]);

  const handleClearBot = useCallback(() => {
    setSelectedBotId(null);
  }, []);

  const handleSaveToSkillsCatalog = useCallback(async () => {
    toast('Save to catalog — coming soon', { icon: '📝' });
  }, []);

  // Close dropdowns on outside click
  useEffect(() => {
    if (!showSkillPicker && !showBotPicker) return;
    const handler = () => { setShowSkillPicker(false); setShowBotPicker(false); };
    const timer = setTimeout(() => document.addEventListener('click', handler), 0);
    return () => { clearTimeout(timer); document.removeEventListener('click', handler); };
  }, [showSkillPicker, showBotPicker]);

  const fileCount = Object.keys(localSkillFiles).length;

  return (
    <div className="flex flex-col h-[calc(100vh-56px)]">
      {/* Page Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-claw-border bg-claw-sidebar/30">
        <div className="flex items-center gap-2.5">
          <h1 className="text-base font-bold text-claw-text">Skills Playground</h1>
          <Badge variant="info">Beta</Badge>

          {selectedBot && (
            <div className="flex items-center gap-1.5 bg-claw-primary/10 border border-claw-primary/30 rounded-lg px-2 py-0.5">
              <Bot size={12} className="text-claw-primary-light" />
              <span className="text-xs font-medium text-claw-primary-light">
                {selectedBot.name ?? selectedBot.agentId}
              </span>
              <button onClick={handleClearBot} className="ml-0.5 text-claw-muted hover:text-claw-text">
                <X size={11} />
              </button>
            </div>
          )}

          {fileCount > 1 && (
            <Badge variant="muted">{fileCount} files</Badge>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {/* Bot Picker */}
          <div className="relative" onClick={(e) => e.stopPropagation()}>
            <Button size="sm" variant="ghost" onClick={() => { setShowBotPicker(!showBotPicker); setShowSkillPicker(false); }}>
              <Bot size={13} />
              Bot
              <ChevronDown size={11} />
            </Button>
            {showBotPicker && (
              <div className="absolute right-0 top-full mt-1 w-64 bg-claw-sidebar border border-claw-border rounded-xl shadow-xl z-50 max-h-64 overflow-y-auto">
                {agents.length === 0 ? (
                  <div className="p-3 text-xs text-claw-muted">No bots available</div>
                ) : (
                  <>
                    {selectedBotId && (
                      <button onClick={handleClearBot} className="w-full text-left px-3 py-2 text-sm text-claw-muted hover:bg-claw-card transition-colors border-b border-claw-border">
                        Clear selection
                      </button>
                    )}
                    {agents.map((agent) => (
                      <button
                        key={agent.id}
                        onClick={() => handleSelectBot(agent.id)}
                        className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                          agent.id === selectedBotId ? 'bg-claw-primary/10 text-claw-primary-light' : 'text-claw-text hover:bg-claw-card'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <Bot size={13} className={agent.id === selectedBotId ? 'text-claw-primary-light' : 'text-claw-muted'} />
                          <div className="min-w-0">
                            <div className="font-medium truncate text-xs">{agent.name ?? agent.agentId}</div>
                            <div className="text-[10px] text-claw-muted truncate">
                              {agent.machineName ?? agent.machineId?.slice(0, 8)}
                            </div>
                          </div>
                        </div>
                      </button>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>

          {/* Skill Picker */}
          <div className="relative" onClick={(e) => e.stopPropagation()}>
            <Button size="sm" variant="ghost" onClick={() => { setShowSkillPicker(!showSkillPicker); setShowBotPicker(false); }}>
              <Download size={13} />
              Load
              <ChevronDown size={11} />
            </Button>
            {showSkillPicker && (
              <div className="absolute right-0 top-full mt-1 w-56 bg-claw-sidebar border border-claw-border rounded-xl shadow-xl z-50 max-h-56 overflow-y-auto">
                {skills.length === 0 ? (
                  <div className="p-3 text-xs text-claw-muted">No skills in catalog</div>
                ) : (
                  skills.map((skill) => (
                    <button
                      key={skill.id}
                      onClick={() => handleSelectSkill(skill.id)}
                      className="w-full text-left px-3 py-2 text-sm text-claw-text hover:bg-claw-card transition-colors"
                    >
                      <div className="font-medium text-xs">{skill.name}</div>
                      <div className="text-[10px] text-claw-muted truncate">{skill.description}</div>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          <Button size="sm" variant="ghost" onClick={() => setShowTemplates(true)}>
            <BookTemplate size={13} />
          </Button>

          <Button size="sm" variant="ghost" onClick={() => setShowHistory(true)}>
            <History size={13} />
          </Button>

          <Button size="sm" variant="ghost" onClick={handleSaveToSkillsCatalog}>
            <Save size={13} />
          </Button>

          <Button
            size="sm"
            variant="primary"
            onClick={handleStartSession}
            loading={createSession.isPending}
            disabled={!!activeSession && activeSession.status === 'active'}
          >
            <Play size={13} />
            {activeSession?.status === 'active' ? 'Running' : 'Start'}
          </Button>
        </div>
      </div>

      {/* Three-Panel Layout */}
      <PanelGroup orientation="horizontal" className="flex-1 min-h-0">
        {/* Left: Skill Editor */}
        <Panel defaultSize={30} minSize={20}>
          <SkillEditorPanel
            skillFiles={localSkillFiles}
            activeFilePath={activeFilePath}
            onSelectFile={setActiveFilePath}
            onFileChange={handleFileChange}
            onAddFile={handleAddFile}
            onDeleteFile={handleDeleteFile}
            onValidate={handleValidate}
            onScan={handleScan}
            validationResult={validationResult}
            scanResult={scanResult}
            validating={validateMutation.isPending}
            scanning={scanMutation.isPending}
            hasSession={!!activeSession}
          />
        </Panel>

        <PanelResizeHandle className="w-1 bg-claw-border hover:bg-claw-primary/40 transition-colors cursor-col-resize" />

        {/* Middle: Skill Optimizer AI */}
        <Panel defaultSize={35} minSize={20}>
          <SkillOptimizerPanel session={activeSession} />
        </Panel>

        <PanelResizeHandle className="w-1 bg-claw-border hover:bg-claw-primary/40 transition-colors cursor-col-resize" />

        {/* Right: Skill Simulator */}
        <Panel defaultSize={35} minSize={20}>
          <SkillChatPanel
            session={activeSession}
            onStop={handleStopSession}
            onNewSession={handleNewSession}
            stopping={stopSession.isPending}
          />
        </Panel>
      </PanelGroup>

      {/* Status Bar */}
      <div className="flex items-center justify-between px-4 py-1 border-t border-claw-border bg-claw-sidebar/30 text-[11px] text-claw-muted">
        <div className="flex items-center gap-3">
          <span>
            {activeSession
              ? `Session: ${activeSession.id.slice(0, 8)}… · ${activeSession.status}`
              : 'No active session'}
          </span>
          {activeSession && (
            <span>{activeSession.messages.length} msgs</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {selectedBot && <span>Bot: {selectedBot.name ?? selectedBot.agentId}</span>}
          <span>{activeFilePath}</span>
          <span>{(localSkillFiles[activeFilePath] ?? '').length} chars</span>
        </div>
      </div>

      {/* Modals */}
      <SkillTemplateGallery
        open={showTemplates}
        onClose={() => setShowTemplates(false)}
        onSelect={handleSelectTemplate}
      />

      <Modal open={showHistory} onClose={() => setShowHistory(false)} title="Test History" width="max-w-xl">
        <SessionHistoryPanel
          sessions={sessions}
          activeSessionId={activeSession?.id ?? null}
          onSelect={(session) => {
            setActiveSession(session);
            setLocalSkillFiles(session.skillFiles ?? { 'SKILL.md': session.skillSnapshot });
            setActiveFilePath('SKILL.md');
            setShowHistory(false);
          }}
          onDelete={(id) => deleteSession.mutate(id)}
        />
      </Modal>
    </div>
  );
}
