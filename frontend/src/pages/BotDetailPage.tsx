import { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { agentsApi } from '../api/agents.api';
import { syncApi } from '../api/sync.api';
import { useAgent, useAgentConfigFiles, useAgentMemoryFiles, useProvisionAgent, useUpdateAgent, useToggleAgentOssSync, useUpdateAgentConfigFile, agentKeys } from '../hooks/useAgents';
import { useAgentSkills, useSkills, useInstallSkill, useRemoveSkillFromAgent, useRemoveDiscoveredSkill, useRemoveGlobalSkill, useRediscoverSkills } from '../hooks/useSkills';
import { StatusDot } from '../components/ui/StatusDot';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { PageSpinner, Spinner } from '../components/ui/Spinner';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { BotConfigChatPanel, ConfigDiffPreview } from '../components/bot-config';
import { MemoryTab } from '../components/memory';
import { ModelConfigTab } from '../components/bots/ModelConfigTab';
import { ChevronLeft, FileText, Bot, Puzzle, Plus, Trash2, Globe, User, Sparkles, Rocket, RefreshCw, Activity, Brain, Cpu, Dna, Share2, Pencil, Check, X, Save, UploadCloud } from 'lucide-react';
import type { SkillCatalogEntry } from '../types/skill';
import EvoClawTab from '../components/bots/EvoClawTab';
import { DistillBundlePreviewModal } from '../components/bots/DistillBundlePreviewModal';
import { DistillStatusModal } from '../components/bots/DistillStatusModal';
import toast from 'react-hot-toast';

const statusLabels: Record<string, string> = {
  draft: '草稿',
  packaging: '打包中',
  syncing: '同步中',
  online: '在线',
  degraded: '降级',
  offline: '离线',
  archived: '已归档',
};

const FILE_DISPLAY_ORDER = [
  'SOUL.md',
  'IDENTITY.md',
  'USER.md',
  'AGENTS.md',
  'TOOLS.md',
  'BOOTSTRAP.md',
  'HEARTBEAT.md',
  'README.md',
];

function isMemoryFile(filename: string): boolean {
  return filename === 'MEMORY.md' || filename === 'memory.md' || filename.startsWith('memory/');
}

function fileSortKey(filename: string): number {
  const idx = FILE_DISPLAY_ORDER.indexOf(filename);
  return idx >= 0 ? idx : FILE_DISPLAY_ORDER.length;
}

type Tab = 'config' | 'ai-config' | 'model' | 'memory' | 'skills' | 'evolution';

export function BotDetailPage() {
  const { agentId } = useParams<{ agentId: string }>();
  const { data: agent, isLoading } = useAgent(agentId!);
  const { data: configData, isLoading: configLoading } = useAgentConfigFiles(agentId!);
  const { data: memoryData } = useAgentMemoryFiles(agentId!);
  const { data: agentSkillsData, isLoading: skillsLoading } = useAgentSkills(agentId!);
  const { data: allSkillsData } = useSkills({ reviewStatus: 'approved' });

  const installSkill = useInstallSkill();
  const removeSkill = useRemoveSkillFromAgent();
  const removeDiscoveredSkill = useRemoveDiscoveredSkill();
  const removeGlobalSkill = useRemoveGlobalSkill();
  const rediscoverSkills = useRediscoverSkills();
  const provisionAgent = useProvisionAgent();
  const updateAgent = useUpdateAgent();
  const toggleOssSync = useToggleAgentOssSync();
  const updateConfigFile = useUpdateAgentConfigFile();

  const [activeTab, setActiveTab] = useState<Tab>('config');
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [configDrafts, setConfigDrafts] = useState<Record<string, string>>({});
  const [syncingConfig, setSyncingConfig] = useState(false);
  const [skillToRemove, setSkillToRemove] = useState<{ key: string; type: 'agent' | 'global' } | null>(null);
  const [autoSyncing, setAutoSyncing] = useState(false);
  const [showDistillModal, setShowDistillModal] = useState(false);
  const [showDistillStatus, setShowDistillStatus] = useState(false);

  // Inline name editing. ``draftName`` is the buffered value while the
  // textbox is open; it is seeded from ``agent.name`` on entry so an
  // unmodified Save still works (and an empty submit clears the field
  // back to ``null`` so the header falls through to ``agent.agentId``).
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState('');

  const queryClient = useQueryClient();
  const syncedAgentIdRef = useRef<string | null>(null);
  const configServerContentRef = useRef<Record<string, string>>({});

  useEffect(() => {
    if (!agentId) return;
    if (syncedAgentIdRef.current === agentId) return;
    syncedAgentIdRef.current = agentId;

    let cancelled = false;
    setAutoSyncing(true);

    Promise.allSettled([
      agentsApi.getConfigFiles(agentId, { refresh: true }),
      agentsApi.getMemoryFiles(agentId, { refresh: true }),
    ])
      .then(([configResult, memoryResult]) => {
        if (cancelled) return;
        if (configResult.status === 'fulfilled') {
          queryClient.setQueryData(agentKeys.configFiles(agentId), configResult.value);
        }
        if (memoryResult.status === 'fulfilled') {
          queryClient.setQueryData(agentKeys.memoryFiles(agentId), memoryResult.value);
        }
        queryClient.invalidateQueries({ queryKey: agentKeys.detail(agentId) });
      })
      .finally(() => {
        if (!cancelled) setAutoSyncing(false);
      });

    return () => {
      cancelled = true;
    };
  }, [agentId, queryClient]);

  useEffect(() => {
    const files = [...(configData?.data ?? [])]
      .filter((f) => !isMemoryFile(f.filename))
      .sort((a, b) => fileSortKey(a.filename) - fileSortKey(b.filename));

    setConfigDrafts((prev) => {
      const next = { ...prev };
      for (const file of files) {
        const previousServerContent = configServerContentRef.current[file.filename];
        if (next[file.filename] === undefined || next[file.filename] === previousServerContent) {
          next[file.filename] = file.content;
        }
      }
      return next;
    });

    configServerContentRef.current = Object.fromEntries(
      files.map((file) => [file.filename, file.content]),
    );
  }, [configData]);

  if (isLoading || !agent) return <PageSpinner />;

  const handleDeploy = () => {
    provisionAgent.mutate({ agentId: agentId! });
  };

  const startEditName = () => {
    setDraftName(agent.name ?? '');
    setEditingName(true);
  };

  const cancelEditName = () => {
    setEditingName(false);
    setDraftName('');
  };

  const submitEditName = () => {
    const next = draftName.trim();
    // No-op when the user didn't actually change anything — saves a
    // backend round-trip and avoids a stray "已保存" toast.
    if (next === (agent.name ?? '')) {
      cancelEditName();
      return;
    }
    updateAgent.mutate(
      // Empty string → null so the header falls back to ``agent.agentId``.
      { agentId: agentId!, data: { name: next === '' ? null : next } },
      {
        onSuccess: () => {
          setEditingName(false);
          setDraftName('');
        },
      },
    );
  };

  const isTransitioning = agent.status === 'packaging' || agent.status === 'syncing';

  const configFiles = (configData?.data ?? []).filter((f) => !isMemoryFile(f.filename));
  const sortedFiles = [...configFiles].sort((a, b) => fileSortKey(a.filename) - fileSortKey(b.filename));

  const activeFile = selectedFile ?? sortedFiles[0]?.filename ?? null;
  const activeFileData = sortedFiles.find((f) => f.filename === activeFile) ?? null;
  const activeContent = activeFileData?.content ?? '';
  const activeDraft = activeFile ? (configDrafts[activeFile] ?? activeContent) : '';
  const activeUnsaved = Boolean(activeFile && activeDraft !== activeContent);
  const hasUnsavedConfigDrafts = sortedFiles.some((f) => (configDrafts[f.filename] ?? f.content) !== f.content);
  const dirtyConfigFiles = sortedFiles.filter((f) => f.localDirty);
  const dirtyRelativePaths = dirtyConfigFiles.map((f) => f.relativePath);

  const installedSkills = agentSkillsData?.data ?? [];
  const installedIds = new Set(installedSkills.map((s) => s.skillCatalogId));
  const allApprovedSkills: SkillCatalogEntry[] = allSkillsData?.data ?? [];
  const availableSkills = allApprovedSkills.filter((s) => !installedIds.has(s.id));

  const globalSkills: string[] = agent.globalSkills ?? [];
  const agentOwnSkills: string[] = agent.discoveredSkills ?? [];
  const totalDiscoveredSkills = globalSkills.length + agentOwnSkills.length;

  const memoryFileCount = memoryData?.totalFiles ?? 0;

  const saveActiveConfigFile = () => {
    if (!agentId || !activeFile || !activeUnsaved) return;
    updateConfigFile.mutate(
      { agentId, filename: activeFile, content: activeDraft },
      {
        onSuccess: (result) => {
          setConfigDrafts((prev) => ({ ...prev, [result.data.filename]: result.data.content }));
          configServerContentRef.current[result.data.filename] = result.data.content;
        },
      },
    );
  };

  const syncConfigFiles = async () => {
    if (!agentId || dirtyRelativePaths.length === 0) return;
    setSyncingConfig(true);
    try {
      const result = await syncApi.push(agent.machineId, { files: dirtyRelativePaths });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: agentKeys.configFiles(agentId) }),
        queryClient.invalidateQueries({ queryKey: agentKeys.detail(agentId) }),
      ]);

      if (result.requiresRestart || result.restartPerformed || result.gatewayRestarted) {
        toast.success(`配置已同步: ${result.syncedFiles} 个文件，变更需要重启/已触发重启`);
      } else {
        toast.success(`配置已热同步: ${result.syncedFiles} 个文件，无需重启`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`同步失败: ${message}`);
    } finally {
      setSyncingConfig(false);
    }
  };

  const tabs: { id: Tab; label: string; icon: typeof FileText; count?: number }[] = [
    { id: 'config', label: '身份配置', icon: FileText, count: sortedFiles.length },
    { id: 'ai-config', label: 'AI 配置助手', icon: Sparkles },
    { id: 'model', label: 'Model 配置', icon: Cpu },
    { id: 'memory', label: '记忆管理', icon: Brain, count: memoryFileCount },
    { id: 'skills', label: 'Skills', icon: Puzzle, count: totalDiscoveredSkills + installedSkills.length },
    { id: 'evolution', label: '自进化', icon: Dna },
  ];

  return (
    <div>
      <Link
        to="/bots"
        className="inline-flex items-center gap-1 text-sm text-claw-muted hover:text-claw-text mb-4 transition-colors"
      >
        <ChevronLeft size={16} />
        返回 Bot 列表
      </Link>

      <Card className="mb-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-claw-primary/25 to-claw-accent/25 flex items-center justify-center">
              <Bot size={24} className="text-claw-primary-light" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                {editingName ? (
                  // Inline rename. The wrapping <form> gives us the
                  // Enter-to-save / Esc-to-cancel keyboard behaviour for
                  // free without manually wiring an onKeyDown for Enter,
                  // and keeps screen-reader semantics correct.
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      submitEditName();
                    }}
                    className="flex items-center gap-1.5"
                  >
                    <input
                      autoFocus
                      value={draftName}
                      onChange={(e) => setDraftName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                          e.preventDefault();
                          cancelEditName();
                        }
                      }}
                      maxLength={200}
                      placeholder={agent.agentId}
                      disabled={updateAgent.isPending}
                      className="text-lg font-bold bg-claw-input border border-claw-primary/60 rounded-md px-2 py-0.5 text-claw-text focus:outline-none focus:border-claw-primary min-w-[14rem]"
                    />
                    <Button
                      type="submit"
                      size="sm"
                      icon={<Check size={13} />}
                      loading={updateAgent.isPending}
                      disabled={updateAgent.isPending}
                    >
                      保存
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      icon={<X size={13} />}
                      onClick={cancelEditName}
                      disabled={updateAgent.isPending}
                    >
                      取消
                    </Button>
                  </form>
                ) : (
                  <h2 className="text-lg font-bold text-claw-text flex items-center gap-1.5 group">
                    <span>{agent.name || agent.agentId}</span>
                    <button
                      type="button"
                      onClick={startEditName}
                      title="重命名 Bot"
                      aria-label="重命名 Bot"
                      className="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity p-1 rounded text-claw-muted hover:text-claw-primary-light"
                    >
                      <Pencil size={13} />
                    </button>
                  </h2>
                )}
                <StatusDot status={agent.status === 'online' ? 'running' : agent.status === 'offline' ? 'offline' : 'paused'} />
              </div>
              <div className="text-sm text-claw-muted mt-0.5">
                {agent.agentId}
                {agent.isDefault && ' · 默认 Agent'}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              icon={<Share2 size={14} />}
              onClick={() => setShowDistillModal(true)}
              title="预览蒸馏快照并推送到 Mini Claw 平台"
            >
              推送到 Mini Claw
            </Button>
            {agent.status === 'draft' && (
              <Button
                size="sm"
                icon={<Rocket size={14} />}
                loading={provisionAgent.isPending}
                onClick={handleDeploy}
              >
                部署 Bot
              </Button>
            )}
            {(agent.status === 'offline' || agent.status === 'packaging') && (
              <>
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<Activity size={14} />}
                >
                  检查状态
                </Button>
                <Button
                  size="sm"
                  icon={<RefreshCw size={14} />}
                  loading={provisionAgent.isPending}
                  onClick={handleDeploy}
                >
                  重新部署
                </Button>
              </>
            )}
            {agent.status === 'syncing' && (
              <div className="flex items-center gap-2 text-sm text-claw-muted">
                <Spinner size={14} />
                {statusLabels[agent.status]}...
              </div>
            )}
            <Badge variant={agent.status === 'online' ? 'success' : agent.status === 'offline' ? 'danger' : 'muted'}>
              {statusLabels[agent.status] ?? agent.status}
            </Badge>
          </div>
        </div>

        <div className="flex gap-6 mt-4 pt-4 border-t border-claw-border text-sm flex-wrap">
          <div>
            <span className="text-claw-muted">Workspace: </span>
            <span className="text-claw-text">{agent.workspacePath ?? '-'}</span>
          </div>
          {agent.lastSyncedAt && (
            <div>
              <span className="text-claw-muted">最后同步: </span>
              <span className="text-claw-text">
                {new Date(agent.lastSyncedAt).toLocaleString()}
              </span>
            </div>
          )}
          {/*
            Surface the daily OSS distill state alongside the SSH "last
            synced". They're independent timelines (SSH = file pull,
            OSS = push to mini-claw vector backend) — keeping both
            visible avoids the confusion of "I just synced, why is
            mini-claw still serving stale memory?".
          */}
          <div>
            <span className="text-claw-muted">最后蒸馏到 OSS: </span>
            {agent.lastOssSyncAt ? (
              <span
                className={
                  agent.lastOssSyncStatus === 'failed'
                    ? 'text-claw-danger'
                    : 'text-claw-text'
                }
                title={
                  agent.lastOssSyncStatus === 'failed'
                    ? agent.lastOssSyncError ?? '失败'
                    : agent.lastOssVectorSha
                      ? `vector_sha=${agent.lastOssVectorSha.slice(0, 12)}…  耗时=${
                          agent.lastOssDurationMs ?? '?'
                        }ms`
                      : ''
                }
              >
                {new Date(agent.lastOssSyncAt).toLocaleString()}
                {agent.lastOssSyncStatus === 'failed' && ' · 失败'}
              </span>
            ) : agent.ossSyncEnabled ? (
              <span className="text-claw-warning">尚未蒸馏</span>
            ) : (
              <span className="text-claw-muted">已退出每日同步</span>
            )}
          </div>
          {/*
            Per-bot opt-in for the nightly OSS distill cron. Off here
            simply removes the bot from the scheduled run; the "推送到
            Mini Claw" button above keeps working regardless, because
            manual pushes are an explicit user action.
          */}
          <div className="flex items-center gap-2">
            <span className="text-claw-muted">每日蒸馏到 OSS:</span>
            <label
              className="inline-flex items-center cursor-pointer"
              title={
                agent.ossSyncEnabled
                  ? '点击关闭后，每日 03:00 (Asia/Shanghai) 的自动同步会跳过这个 Bot；手动推送不受影响。'
                  : '点击开启后，下一次每日定时任务会把这个 Bot 也同步到 OSS。'
              }
            >
              <input
                type="checkbox"
                checked={agent.ossSyncEnabled}
                disabled={toggleOssSync.isPending}
                onChange={(e) =>
                  toggleOssSync.mutate({
                    agentId: agent.id,
                    enabled: e.target.checked,
                  })
                }
                className="sr-only peer"
                aria-label="切换每日蒸馏到 OSS"
              />
              <div className="w-9 h-5 bg-claw-border rounded-full peer-checked:bg-claw-primary relative transition-colors">
                <div
                  className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
                    agent.ossSyncEnabled ? 'translate-x-4' : ''
                  }`}
                />
              </div>
            </label>
            <span
              className={`text-xs ${
                agent.ossSyncEnabled ? 'text-claw-success' : 'text-claw-muted'
              }`}
            >
              {agent.ossSyncEnabled ? '已启用' : '已禁用'}
            </span>
          </div>
          {autoSyncing && (
            <div className="flex items-center gap-1.5 text-claw-muted">
              <Spinner size={12} />
              正在同步远程节点...
            </div>
          )}
        </div>
      </Card>

      {/* Tabs */}
      <div className="flex gap-1 mb-4">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 rounded-lg text-sm cursor-pointer transition-all flex items-center gap-1.5 ${
                activeTab === tab.id
                  ? 'bg-claw-primary text-white font-medium'
                  : 'bg-claw-card text-claw-muted border border-claw-border hover:text-claw-text'
              }`}
            >
              <Icon size={14} />
              {tab.label}
              {tab.count !== undefined && (
                <span className={`text-xs ${activeTab === tab.id ? 'text-white/70' : 'text-claw-muted'}`}>
                  ({tab.count})
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Config Files Tab */}
      {activeTab === 'config' && (
        <>
          {configLoading ? (
            <div className="flex items-center gap-2 py-8 justify-center text-claw-muted text-sm">
              <Spinner size={16} />
              正在从远程节点读取配置文件...
            </div>
          ) : sortedFiles.length === 0 ? (
            <div className="text-claw-muted text-sm py-8 text-center">
              该 Bot 尚未配置身份文件
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  {dirtyConfigFiles.length > 0 ? (
                    <Badge variant="warning">有未同步修改 · 需要同步生效</Badge>
                  ) : (
                    <Badge variant="success">已同步</Badge>
                  )}
                  {hasUnsavedConfigDrafts && <Badge variant="info">有未保存草稿</Badge>}
                </div>
                <Button
                  size="sm"
                  icon={<UploadCloud size={14} />}
                  loading={syncingConfig}
                  disabled={dirtyRelativePaths.length === 0 || syncingConfig}
                  onClick={syncConfigFiles}
                >
                  同步配置到 Bot
                </Button>
              </div>

              <div className="flex gap-4 h-[500px]">
                <div className="w-52 shrink-0 overflow-auto border border-claw-border rounded-xl bg-claw-input">
                  <div className="px-3 py-2 text-xs text-claw-muted font-semibold border-b border-claw-border">
                    配置文件 ({sortedFiles.length})
                  </div>
                  {sortedFiles.map((f) => {
                    const fileUnsaved = (configDrafts[f.filename] ?? f.content) !== f.content;
                    return (
                      <button
                        key={f.filename}
                        onClick={() => setSelectedFile(f.filename)}
                        className={`w-full text-left px-3 py-2.5 text-sm flex items-center gap-2 border-b border-claw-border last:border-0 cursor-pointer transition-colors
                          ${activeFile === f.filename ? 'bg-claw-primary/15 text-claw-primary-light' : 'text-claw-text hover:bg-claw-card'}`}
                      >
                        <FileText size={14} className="shrink-0" />
                        <span className="truncate flex-1">{f.filename}</span>
                        {fileUnsaved ? (
                          <span className="w-2 h-2 rounded-full bg-claw-primary-light shrink-0" title="未保存" />
                        ) : f.localDirty ? (
                          <span className="w-2 h-2 rounded-full bg-claw-warning shrink-0" title="待同步" />
                        ) : null}
                      </button>
                    );
                  })}
                </div>

                <div className="flex-1 flex flex-col border border-claw-border rounded-xl overflow-hidden">
                  {activeFile ? (
                    <>
                      <div className="flex items-center justify-between gap-3 px-4 py-2 bg-claw-input border-b border-claw-border">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-sm text-claw-text font-medium truncate">{activeFile}</span>
                          {activeUnsaved ? (
                            <Badge variant="info" className="shrink-0">未保存</Badge>
                          ) : (
                            <Badge variant="success" className="shrink-0">已保存</Badge>
                          )}
                          {activeFileData?.localDirty && (
                            <Badge variant="warning" className="shrink-0">待同步</Badge>
                          )}
                        </div>
                        <Button
                          size="sm"
                          icon={<Save size={14} />}
                          loading={updateConfigFile.isPending}
                          disabled={!activeUnsaved || updateConfigFile.isPending}
                          onClick={saveActiveConfigFile}
                        >
                          保存
                        </Button>
                      </div>
                      <textarea
                        value={activeDraft}
                        onChange={(e) => {
                          if (!activeFile) return;
                          setConfigDrafts((prev) => ({ ...prev, [activeFile]: e.target.value }));
                        }}
                        spellCheck={false}
                        className="flex-1 bg-claw-bg text-claw-text text-sm p-4 overflow-auto font-mono resize-none outline-none focus:ring-1 focus:ring-inset focus:ring-claw-primary/60"
                        aria-label={`${activeFile} 配置内容`}
                      />
                    </>
                  ) : (
                    <div className="flex-1 flex items-center justify-center text-claw-muted text-sm">
                      选择一个文件编辑
                    </div>
                  )}
                </div>
              </div>

              {dirtyConfigFiles.length > 0 && (
                <div className="text-xs text-claw-warning">
                  待同步文件: {dirtyConfigFiles.map((f) => f.filename).join(', ')}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* AI Config Tab */}
      {activeTab === 'ai-config' && (
        <div className="flex gap-4 h-[600px]">
          <div className="flex-1 border border-claw-border rounded-xl overflow-hidden">
            <BotConfigChatPanel
              agentId={agentId!}
              agentName={agent.name || agent.agentId}
            />
          </div>
          <div className="w-[400px] shrink-0 border border-claw-border rounded-xl overflow-hidden">
            <ConfigDiffPreview agentId={agentId!} />
          </div>
        </div>
      )}

      {/* Model Config Tab */}
      {activeTab === 'model' && (
        <ModelConfigTab agentId={agentId!} machineId={agent.machineId} />
      )}

      {/* Memory Tab */}
      {activeTab === 'memory' && (
        <MemoryTab agentId={agentId!} />
      )}

      {/* Skills Tab */}
      {activeTab === 'skills' && (
        <div className="space-y-5">
          <div className="flex justify-end">
            <Button
              variant="secondary"
              size="sm"
              icon={<RefreshCw size={13} className={rediscoverSkills.isPending ? 'animate-spin' : ''} />}
              loading={rediscoverSkills.isPending}
              onClick={() => rediscoverSkills.mutate(agentId!)}
            >
              刷新 Skills 发现
            </Button>
          </div>

          {/* Discovered: Global Skills (shared across all agents on this machine) */}
          <div>
            <h4 className="text-sm font-semibold text-claw-text mb-3 flex items-center gap-2">
              <Globe size={14} className="text-claw-primary-light" />
              共享 Skills
              <span className="text-xs text-claw-muted font-normal">（节点级，所有 Bot 共享）</span>
            </h4>
            {globalSkills.length === 0 ? (
              <div className="text-claw-muted text-sm py-4 text-center border border-claw-border rounded-xl">
                该节点未发现共享 Skills（./openclaw/skills/）
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {globalSkills.map((skill) => (
                  <div
                    key={skill}
                    className="bg-claw-card rounded-xl border border-claw-border p-4 flex items-center justify-between"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500/25 to-cyan-500/25 flex items-center justify-center shrink-0">
                        <Globe size={14} className="text-blue-400" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-claw-text truncate">{skill}</div>
                        <div className="text-xs text-claw-muted">共享 · 节点级</div>
                      </div>
                    </div>
                    <Button
                      variant="danger"
                      size="sm"
                      icon={<Trash2 size={13} />}
                      onClick={() => setSkillToRemove({ key: skill, type: 'global' })}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Discovered: Agent-specific Skills */}
          <div>
            <h4 className="text-sm font-semibold text-claw-text mb-3 flex items-center gap-2">
              <User size={14} className="text-claw-accent" />
              专属 Skills
              <span className="text-xs text-claw-muted font-normal">（该 Bot 独有）</span>
            </h4>
            {agentOwnSkills.length === 0 ? (
              <div className="text-claw-muted text-sm py-4 text-center border border-claw-border rounded-xl">
                该 Bot 未发现专属 Skills（{agent.workspacePath}/skills/）
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {agentOwnSkills.map((skill) => (
                  <div
                    key={skill}
                    className="bg-claw-card rounded-xl border border-claw-border p-4 flex items-center justify-between"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500/25 to-fuchsia-500/25 flex items-center justify-center shrink-0">
                        <User size={14} className="text-purple-400" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-claw-text truncate">{skill}</div>
                        <div className="text-xs text-claw-muted">专属 · Bot 级</div>
                      </div>
                    </div>
                    <Button
                      variant="danger"
                      size="sm"
                      icon={<Trash2 size={13} />}
                      onClick={() => setSkillToRemove({ key: skill, type: 'agent' })}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Managed Skills (installed via catalog) */}
          <div>
            <h4 className="text-sm font-semibold text-claw-text mb-3 flex items-center gap-2">
              <Puzzle size={14} className="text-green-400" />
              已分配 Skills
              <span className="text-xs text-claw-muted font-normal">（从 Skills 目录安装）</span>
            </h4>
            {skillsLoading ? (
              <div className="flex items-center gap-2 py-6 justify-center text-claw-muted text-sm">
                <Spinner size={16} />
                加载中...
              </div>
            ) : installedSkills.length === 0 ? (
              <div className="text-claw-muted text-sm py-4 text-center border border-claw-border rounded-xl">
                该 Bot 尚未分配任何目录 Skill
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {installedSkills.map((install) => (
                  <div
                    key={install.id}
                    className="bg-claw-card rounded-xl border border-claw-border p-4 flex items-center justify-between"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-green-500/30 to-emerald-500/30 flex items-center justify-center shrink-0">
                        <Puzzle size={14} className="text-green-400" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-claw-text truncate">
                          {install.skill?.name ?? install.skillCatalogId}
                        </div>
                        <div className="text-xs text-claw-muted">
                          {install.scope === 'global' ? '全局' : 'Agent'} · {install.enabled ? '已启用' : '已禁用'}
                        </div>
                      </div>
                    </div>
                    <Button
                      variant="danger"
                      size="sm"
                      icon={<Trash2 size={13} />}
                      loading={removeSkill.isPending}
                      onClick={() =>
                        removeSkill.mutate({
                          agentId: agentId!,
                          skillCatalogId: install.skillCatalogId,
                        })
                      }
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Available Skills */}
          <div>
            <h4 className="text-sm font-semibold text-claw-text mb-3">可分配 Skills</h4>
            {availableSkills.length === 0 ? (
              <div className="text-claw-muted text-sm py-4 text-center border border-claw-border rounded-xl">
                没有可分配的 Skill（所有已审核的 Skill 均已安装，或 Skills 目录为空）
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {availableSkills.map((skill) => (
                  <div
                    key={skill.id}
                    className="bg-claw-card rounded-xl border border-claw-border p-4 flex items-center justify-between"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-claw-primary/20 to-claw-accent/20 flex items-center justify-center shrink-0">
                        <Puzzle size={14} className="text-claw-primary-light" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-claw-text truncate">
                          {skill.name}
                        </div>
                        <div className="text-xs text-claw-muted truncate">
                          {skill.description ?? skill.skillKey}
                        </div>
                      </div>
                    </div>
                    <Button
                      variant="primary"
                      size="sm"
                      icon={<Plus size={13} />}
                      loading={installSkill.isPending}
                      onClick={() =>
                        installSkill.mutate({
                          agentId: agentId!,
                          data: { skillCatalogId: skill.id },
                        })
                      }
                    >
                      分配
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Evolution Tab */}
      {activeTab === 'evolution' && (
        <EvoClawTab agentId={agentId!} machineId={agent.machineId} />
      )}

      <DistillBundlePreviewModal
        open={showDistillModal}
        onClose={() => setShowDistillModal(false)}
        machineId={agent.machineId}
        agentId={agentId!}
        agentDisplayName={agent.name || agent.agentId}
        onOpenDashboard={() => {
          setShowDistillModal(false);
          setShowDistillStatus(true);
        }}
      />

      <DistillStatusModal
        open={showDistillStatus}
        onClose={() => setShowDistillStatus(false)}
      />

      <ConfirmDialog
        open={!!skillToRemove}
        onClose={() => setSkillToRemove(null)}
        title={skillToRemove?.type === 'global' ? '移除共享 Skill' : '移除专属 Skill'}
        message={
          skillToRemove?.type === 'global'
            ? `确定要移除共享 Skill "${skillToRemove.key}" 吗？此操作将删除远程节点上的 Skill 文件，且会影响该节点上的所有 Bot。此操作不可撤销。`
            : `确定要移除专属 Skill "${skillToRemove?.key}" 吗？此操作将删除远程节点上的 Skill 文件，不可撤销。`
        }
        confirmLabel="移除"
        variant="danger"
        loading={removeDiscoveredSkill.isPending || removeGlobalSkill.isPending}
        onConfirm={() => {
          if (!skillToRemove) return;
          const mutation = skillToRemove.type === 'global' ? removeGlobalSkill : removeDiscoveredSkill;
          mutation.mutate(
            { agentId: agentId!, skillKey: skillToRemove.key },
            { onSettled: () => setSkillToRemove(null) },
          );
        }}
      />
    </div>
  );
}
