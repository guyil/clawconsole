import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAllAgents, useDeleteAgent } from '../hooks/useAgents';
import { useDiscoverAll } from '../hooks/useMachines';
import { useDistillStatus } from '../hooks/useDistillStatus';
import { StatusDot } from '../components/ui/StatusDot';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { PageSpinner } from '../components/ui/Spinner';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { CreateBotWizard } from '../components/bots/CreateBotWizard';
import { DistillToMiniclawModal } from '../components/bots/DistillToMiniclawModal';
import { DistillStatusModal } from '../components/bots/DistillStatusModal';
import { ConfigureFeishuModal } from '../components/bots/ConfigureFeishuModal';
import { Bot, Server, Puzzle, Plus, Trash2, Sparkles, RefreshCw, CloudUpload, AlertCircle } from 'lucide-react';
import type { AgentWithMachine } from '../types/agent';

const statusLabels: Record<string, string> = {
  draft: '草稿',
  packaging: '打包中',
  syncing: '同步中',
  online: '在线',
  degraded: '降级',
  offline: '离线',
  archived: '已归档',
};

const PROVISIONABLE_STATUSES = new Set(['draft', 'packaging', 'offline']);

/**
 * Render a compact "上次蒸馏到 OSS" line for the bot card. NULL = never
 * (warning badge), 'failed' = surface the error count visually so the
 * user knows to open the status modal, 'ok' = relative time + green dot.
 */
function ossSyncRelative(iso: string | null, now: number): string {
  if (!iso) return '从未';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const deltaMs = Math.max(0, now - t);
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return `${days} 天前`;
}

interface BotCardProps {
  agent: AgentWithMachine;
  onClick: () => void;
  onDelete: (e: React.MouseEvent) => void;
  onConfigureFeishu: (e: React.MouseEvent) => void;
}

function BotCard({ agent, onClick, onDelete, onConfigureFeishu }: BotCardProps) {
  const isProvisionable = PROVISIONABLE_STATUSES.has(agent.status);
  return (
    <div
      onClick={onClick}
      className="bg-claw-card rounded-xl border border-claw-border p-4 transition-all cursor-pointer hover:bg-claw-card-hover hover:border-claw-primary/40 group"
    >
      <div className="flex justify-between items-center mb-3">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-claw-primary/30 to-claw-accent/30 flex items-center justify-center">
            <Bot size={18} className="text-claw-primary-light" />
          </div>
          <div>
            <div className="text-sm font-semibold text-claw-text">
              {agent.name || agent.agentId}
            </div>
            <div className="text-xs text-claw-muted">{agent.agentId}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onDelete}
            className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-md hover:bg-red-500/20 text-claw-muted hover:text-red-400"
            title="删除 Bot"
          >
            <Trash2 size={14} />
          </button>
          <StatusDot status={agent.status === 'online' ? 'running' : agent.status === 'offline' ? 'offline' : 'paused'} />
        </div>
      </div>

      <div className="flex gap-2 flex-wrap items-center">
        <Badge variant={agent.status === 'online' ? 'success' : agent.status === 'offline' ? 'danger' : 'muted'}>
          {statusLabels[agent.status] ?? agent.status}
        </Badge>
        {agent.isDefault && <Badge variant="info">默认</Badge>}
        {agent.status === 'draft' && !agent.lastSyncedAt && (
          <Badge variant="warning">未部署</Badge>
        )}
      </div>

      <div className="flex items-center gap-3 mt-3 text-[11px] text-claw-muted">
        <span className="flex items-center gap-1">
          <Server size={11} />
          {agent.machineName}
        </span>
        {((agent.discoveredSkills?.length ?? 0) + (agent.globalSkills?.length ?? 0)) > 0 && (
          <span className="flex items-center gap-1">
            <Puzzle size={11} />
            Skills: {(agent.discoveredSkills?.length ?? 0) + (agent.globalSkills?.length ?? 0)}
          </span>
        )}
        <span
          className={`flex items-center gap-1 ${
            agent.lastOssSyncStatus === 'failed'
              ? 'text-claw-danger'
              : agent.lastOssSyncStatus === 'ok'
                ? 'text-claw-muted'
                : 'text-claw-warning'
          }`}
          title={
            agent.lastOssSyncStatus === 'failed'
              ? `OSS 蒸馏失败: ${agent.lastOssSyncError ?? '未知错误'}`
              : agent.lastOssSyncAt
                ? `OSS 蒸馏: ${new Date(agent.lastOssSyncAt).toLocaleString()}`
                : '尚未蒸馏到 OSS'
          }
        >
          <CloudUpload size={11} />
          OSS: {ossSyncRelative(agent.lastOssSyncAt, Date.now())}
          {agent.lastOssSyncStatus === 'failed' && <AlertCircle size={11} />}
        </span>
      </div>

      {isProvisionable && (
        <div className="mt-3 pt-3 border-t border-claw-border/60">
          <button
            onClick={onConfigureFeishu}
            className="w-full text-xs font-medium text-claw-primary-light bg-claw-primary/10 hover:bg-claw-primary/20 border border-claw-primary/20 rounded-md px-2.5 py-1.5 transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
            title="为该 Bot 绑定飞书并立即部署"
          >
            <span className="text-sm leading-none">🐦</span>
            配置飞书
          </button>
        </div>
      )}
    </div>
  );
}

const NODE_FILTER_STORAGE_KEY = 'clawconsole:bots:nodeFilter';

export function BotsPage() {
  const { data, isLoading } = useAllAgents();
  const navigate = useNavigate();
  const [wizardOpen, setWizardOpen] = useState(false);
  const [distillOpen, setDistillOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AgentWithMachine | null>(null);
  const [feishuTarget, setFeishuTarget] = useState<AgentWithMachine | null>(null);
  // null = 全部节点. Persisted to localStorage so a user who lives on
  // one node doesn't have to re-pick the filter on every page reload.
  const [nodeFilter, setNodeFilter] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(NODE_FILTER_STORAGE_KEY);
  });
  const deleteMutation = useDeleteAgent();
  const discoverAll = useDiscoverAll();
  // Lightweight ping to keep the "蒸馏状态" header pill fresh — gated on
  // the modal being closed so we only have one poller in-flight at a
  // time when the user opens the dashboard.
  const { data: statusSummary } = useDistillStatus({
    enabled: !statusOpen,
    refetchIntervalMs: 120_000,
  });

  const handleSelectNodeFilter = (machineId: string | null) => {
    setNodeFilter(machineId);
    if (typeof window === 'undefined') return;
    if (machineId) {
      window.localStorage.setItem(NODE_FILTER_STORAGE_KEY, machineId);
    } else {
      window.localStorage.removeItem(NODE_FILTER_STORAGE_KEY);
    }
  };

  if (isLoading) return <PageSpinner />;

  const agents = data?.data ?? [];

  // Build the per-machine grouping off the unfiltered list so the filter
  // chips can show accurate per-node counts even when the user is
  // currently zoomed in on a single node.
  const grouped = agents.reduce<Record<string, { machineName: string; agents: AgentWithMachine[] }>>((acc, agent) => {
    if (!acc[agent.machineId]) {
      acc[agent.machineId] = { machineName: agent.machineName, agents: [] };
    }
    acc[agent.machineId].agents.push(agent);
    return acc;
  }, {});

  // If the saved filter points at a machine that no longer has bots
  // (deleted machine, bots all archived, etc.), treat it as "全部" so
  // the page never renders empty for a stale localStorage value.
  const activeFilter = nodeFilter && grouped[nodeFilter] ? nodeFilter : null;
  const filteredAgents = activeFilter ? grouped[activeFilter].agents : agents;
  const filteredGroups = activeFilter
    ? { [activeFilter]: grouped[activeFilter] }
    : grouped;

  const draftCount = filteredAgents.filter((a) => a.status === 'draft').length;
  const nodeChips = Object.entries(grouped)
    .map(([id, g]) => ({ id, name: g.machineName, count: g.agents.length }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div>
      <div className="flex justify-between items-center mb-5">
        <div className="text-[13px] text-claw-muted flex items-center gap-2 flex-wrap">
          <span>
            {activeFilter
              ? `${grouped[activeFilter].machineName} · ${filteredAgents.length} 个 Bot`
              : `共 ${agents.length} 个 Bot`}
          </span>
          {draftCount > 0 && (
            <span className="text-claw-warning">· {draftCount} 个待部署</span>
          )}
          {statusSummary && statusSummary.summary.total > 0 && (
            <button
              type="button"
              onClick={() => setStatusOpen(true)}
              className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border transition-colors hover:bg-claw-card cursor-pointer ${
                statusSummary.summary.failed > 0
                  ? 'border-claw-danger/40 text-claw-danger'
                  : statusSummary.summary.neverSynced > 0
                    ? 'border-claw-warning/40 text-claw-warning'
                    : 'border-claw-success/30 text-claw-success'
              }`}
              title="点击查看每日蒸馏到 OSS 的执行状态"
            >
              <CloudUpload size={11} />
              OSS 蒸馏 {statusSummary.summary.ok}/{statusSummary.summary.total}
              {statusSummary.summary.failed > 0 && (
                <span>· {statusSummary.summary.failed} 失败</span>
              )}
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            icon={<RefreshCw size={14} className={discoverAll.isPending ? 'animate-spin' : ''} />}
            loading={discoverAll.isPending}
            onClick={() => discoverAll.mutate()}
            title="扫描所有在线节点上的 workspace-* 文件夹，新发现的 Bot 会以「草稿」状态显示在列表中"
          >
            刷新
          </Button>
          <Button
            size="sm"
            variant="secondary"
            icon={<CloudUpload size={14} />}
            onClick={() => setStatusOpen(true)}
            title="查看每日蒸馏到 OSS 的执行状态、下次执行时间、逐 agent 成败"
          >
            OSS 蒸馏状态
          </Button>
          <Button
            size="sm"
            variant="secondary"
            icon={<Sparkles size={14} />}
            onClick={() => setDistillOpen(true)}
            title="将所有 OpenClaw agents + 它们的 skills 蒸馏到 Mini Claw 的 Agents Hub"
          >
            蒸馏到 Mini Claw
          </Button>
          <Button size="sm" icon={<Plus size={14} />} onClick={() => setWizardOpen(true)}>
            新建 Bot
          </Button>
        </div>
      </div>

      <CreateBotWizard open={wizardOpen} onClose={() => setWizardOpen(false)} />
      <DistillToMiniclawModal open={distillOpen} onClose={() => setDistillOpen(false)} />
      <DistillStatusModal open={statusOpen} onClose={() => setStatusOpen(false)} />
      <ConfigureFeishuModal
        open={!!feishuTarget}
        onClose={() => setFeishuTarget(null)}
        agent={feishuTarget}
      />

      {nodeChips.length > 1 && (
        <div className="flex items-center gap-2 mb-5 flex-wrap">
          <button
            type="button"
            onClick={() => handleSelectNodeFilter(null)}
            className={`inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border transition-colors cursor-pointer ${
              activeFilter === null
                ? 'bg-claw-primary/20 border-claw-primary/40 text-claw-primary-light'
                : 'bg-claw-card border-claw-border text-claw-muted hover:bg-claw-card-hover hover:text-claw-text'
            }`}
          >
            全部
            <span className="text-[10px] opacity-70">{agents.length}</span>
          </button>
          {nodeChips.map((chip) => {
            const selected = activeFilter === chip.id;
            return (
              <button
                key={chip.id}
                type="button"
                onClick={() => handleSelectNodeFilter(chip.id)}
                className={`inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border transition-colors cursor-pointer ${
                  selected
                    ? 'bg-claw-primary/20 border-claw-primary/40 text-claw-primary-light'
                    : 'bg-claw-card border-claw-border text-claw-muted hover:bg-claw-card-hover hover:text-claw-text'
                }`}
                title={`只查看 ${chip.name} 节点上的 Bot`}
              >
                <Server size={11} />
                {chip.name}
                <span className="text-[10px] opacity-70">{chip.count}</span>
              </button>
            );
          })}
        </div>
      )}

      {agents.length === 0 ? (
        <EmptyState
          icon={<Bot size={48} />}
          title="暂无 Bot"
          description="请先在节点管理中注册节点并扫描 Agent，或点击右上角「刷新」自动发现"
          action={
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                icon={<RefreshCw size={14} className={discoverAll.isPending ? 'animate-spin' : ''} />}
                loading={discoverAll.isPending}
                onClick={() => discoverAll.mutate()}
              >
                扫描节点
              </Button>
              <Button size="sm" icon={<Plus size={14} />} onClick={() => setWizardOpen(true)}>
                新建 Bot
              </Button>
            </div>
          }
        />
      ) : (
        <div className="space-y-6">
          {Object.entries(filteredGroups).map(([machineId, group]) => (
            <div key={machineId}>
              <div className="flex items-center gap-2 mb-3">
                <Server size={14} className="text-claw-muted" />
                <h3 className="text-sm font-semibold text-claw-text">{group.machineName}</h3>
                <span className="text-xs text-claw-muted">({group.agents.length})</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {group.agents.map((agent) => (
                  <BotCard
                    key={agent.id}
                    agent={agent}
                    onClick={() => navigate(`/bots/${agent.id}`)}
                    onDelete={(e) => { e.stopPropagation(); setDeleteTarget(agent); }}
                    onConfigureFeishu={(e) => { e.stopPropagation(); setFeishuTarget(agent); }}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (!deleteTarget) return;
          deleteMutation.mutate(
            { agentId: deleteTarget.id, cleanRemote: true },
            { onSettled: () => setDeleteTarget(null) },
          );
        }}
        title="删除 Bot"
        message={`确定要删除 "${deleteTarget?.name || deleteTarget?.agentId}" 吗？这将同时清理远端节点上的工作区文件夹，此操作不可恢复。`}
        confirmLabel="删除"
        variant="danger"
        loading={deleteMutation.isPending}
      />
    </div>
  );
}
