import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAgent, useAgentConfigFiles } from '../hooks/useAgents';
import { useAgentSkills, useSkills, useInstallSkill, useRemoveSkillFromAgent } from '../hooks/useSkills';
import { StatusDot } from '../components/ui/StatusDot';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { PageSpinner, Spinner } from '../components/ui/Spinner';
import { BotConfigChatPanel, ConfigDiffPreview } from '../components/bot-config';
import { ChevronLeft, FileText, Bot, Puzzle, Plus, Trash2, Globe, User, Sparkles } from 'lucide-react';
import type { SkillCatalogEntry } from '../types/skill';

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

function fileSortKey(filename: string): number {
  const idx = FILE_DISPLAY_ORDER.indexOf(filename);
  return idx >= 0 ? idx : FILE_DISPLAY_ORDER.length;
}

type Tab = 'config' | 'ai-config' | 'skills';

export function BotDetailPage() {
  const { agentId } = useParams<{ agentId: string }>();
  const { data: agent, isLoading } = useAgent(agentId!);
  const { data: configData, isLoading: configLoading } = useAgentConfigFiles(agentId!);
  const { data: agentSkillsData, isLoading: skillsLoading } = useAgentSkills(agentId!);
  const { data: allSkillsData } = useSkills({ reviewStatus: 'approved' });

  const installSkill = useInstallSkill();
  const removeSkill = useRemoveSkillFromAgent();

  const [activeTab, setActiveTab] = useState<Tab>('config');
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  if (isLoading || !agent) return <PageSpinner />;

  const configFiles = configData?.data ?? [];
  const sortedFiles = [...configFiles].sort((a, b) => fileSortKey(a.filename) - fileSortKey(b.filename));

  const activeFile = selectedFile ?? sortedFiles[0]?.filename ?? null;
  const activeContent = sortedFiles.find((f) => f.filename === activeFile)?.content ?? '';

  const installedSkills = agentSkillsData?.data ?? [];
  const installedIds = new Set(installedSkills.map((s) => s.skillCatalogId));
  const allApprovedSkills: SkillCatalogEntry[] = allSkillsData?.data ?? [];
  const availableSkills = allApprovedSkills.filter((s) => !installedIds.has(s.id));

  const globalSkills: string[] = (agent as Record<string, unknown>).globalSkills as string[] ?? [];
  const agentOwnSkills: string[] = agent.discoveredSkills ?? [];
  const totalDiscoveredSkills = globalSkills.length + agentOwnSkills.length;

  const tabs: { id: Tab; label: string; icon: typeof FileText; count?: number }[] = [
    { id: 'config', label: '身份配置', icon: FileText, count: sortedFiles.length },
    { id: 'ai-config', label: 'AI 配置助手', icon: Sparkles },
    { id: 'skills', label: 'Skills', icon: Puzzle, count: totalDiscoveredSkills + installedSkills.length },
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
                <h2 className="text-lg font-bold text-claw-text">
                  {agent.name || agent.agentId}
                </h2>
                <StatusDot status={agent.status === 'online' ? 'running' : agent.status === 'offline' ? 'offline' : 'paused'} />
              </div>
              <div className="text-sm text-claw-muted mt-0.5">
                {agent.agentId}
                {agent.isDefault && ' · 默认 Agent'}
              </div>
            </div>
          </div>
          <Badge variant={agent.status === 'online' ? 'success' : agent.status === 'offline' ? 'danger' : 'muted'}>
            {statusLabels[agent.status] ?? agent.status}
          </Badge>
        </div>

        <div className="flex gap-6 mt-4 pt-4 border-t border-claw-border text-sm">
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
            <div className="flex gap-4 h-[500px]">
              <div className="w-52 shrink-0 overflow-auto border border-claw-border rounded-xl bg-claw-input">
                <div className="px-3 py-2 text-xs text-claw-muted font-semibold border-b border-claw-border">
                  配置文件 ({sortedFiles.length})
                </div>
                {sortedFiles.map((f) => (
                  <button
                    key={f.filename}
                    onClick={() => setSelectedFile(f.filename)}
                    className={`w-full text-left px-3 py-2.5 text-sm flex items-center gap-2 border-b border-claw-border last:border-0 cursor-pointer transition-colors
                      ${activeFile === f.filename ? 'bg-claw-primary/15 text-claw-primary-light' : 'text-claw-text hover:bg-claw-card'}`}
                  >
                    <FileText size={14} />
                    <span className="truncate">{f.filename}</span>
                  </button>
                ))}
              </div>

              <div className="flex-1 flex flex-col border border-claw-border rounded-xl overflow-hidden">
                {activeFile ? (
                  <>
                    <div className="flex items-center px-4 py-2 bg-claw-input border-b border-claw-border">
                      <span className="text-sm text-claw-text font-medium">{activeFile}</span>
                      <Badge variant="muted" className="ml-2">只读</Badge>
                    </div>
                    <pre className="flex-1 bg-claw-bg text-claw-text text-sm p-4 overflow-auto font-mono whitespace-pre-wrap">
                      {activeContent}
                    </pre>
                  </>
                ) : (
                  <div className="flex-1 flex items-center justify-center text-claw-muted text-sm">
                    选择一个文件查看
                  </div>
                )}
              </div>
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

      {/* Skills Tab */}
      {activeTab === 'skills' && (
        <div className="space-y-5">
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
                    className="bg-claw-card rounded-xl border border-claw-border p-4 flex items-center gap-3"
                  >
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500/25 to-cyan-500/25 flex items-center justify-center shrink-0">
                      <Globe size={14} className="text-blue-400" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-claw-text truncate">{skill}</div>
                      <div className="text-xs text-claw-muted">共享 · 节点级</div>
                    </div>
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
                    className="bg-claw-card rounded-xl border border-claw-border p-4 flex items-center gap-3"
                  >
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500/25 to-fuchsia-500/25 flex items-center justify-center shrink-0">
                      <User size={14} className="text-purple-400" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-claw-text truncate">{skill}</div>
                      <div className="text-xs text-claw-muted">专属 · Bot 级</div>
                    </div>
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
    </div>
  );
}
