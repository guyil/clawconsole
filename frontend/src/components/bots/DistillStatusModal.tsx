/**
 * Daily-OSS-backup status dashboard.
 *
 * Surfaces the data exposed by ``GET /api/distill/push-to-oss/status``
 * so the user can answer the three "is the cron healthy?" questions
 * without leaving the BotsPage:
 *
 *   1. When does it run next? (cron pattern + computed nextRunAt)
 *   2. Did the last run succeed? (recent BullMQ job status + duration)
 *   3. Which agents are stuck / never synced? (per-agent table with
 *      lastOssSyncAt, status, error message, duration)
 *
 * The modal auto-refreshes every 60s while open. Polling pauses when
 * the modal is closed (the hook is gated on the ``open`` prop) so we
 * don't keep hitting the API for nothing.
 */
import { useMemo, useState } from 'react';
import { Modal } from '../ui/Modal';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Spinner } from '../ui/Spinner';
import { useDistillStatus } from '../../hooks/useDistillStatus';
import { useToggleAgentOssSync } from '../../hooks/useAgents';
import { CheckCircle2, AlertCircle, Clock, RefreshCw, Server, Loader2 } from 'lucide-react';
import type { DistillStatusAgent, DistillStatusMachine } from '../../types/distill-status';

interface Props {
  open: boolean;
  onClose: () => void;
}

/** Format a millisecond timestamp delta as "5 分钟前" / "2 小时前". */
function formatRelative(iso: string | null, now: number): string {
  if (!iso) return '从未';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const deltaMs = now - t;
  if (deltaMs < 0) {
    // Future timestamp (cron's nextRunAt). Express as "Xh Ym 后".
    const future = Math.abs(deltaMs);
    const hours = Math.floor(future / 3_600_000);
    const minutes = Math.floor((future % 3_600_000) / 60_000);
    if (hours > 0) return `${hours} 小时 ${minutes} 分后`;
    if (minutes > 0) return `${minutes} 分钟后`;
    return '即将执行';
  }
  const seconds = Math.floor(deltaMs / 1000);
  if (seconds < 60) return `${seconds} 秒前`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return `${days} 天前`;
}

function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—';
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rs = Math.round(s % 60);
  return `${m}m${rs}s`;
}

/**
 * Sort: failures first, then never-synced (still opted-in), then synced
 * (oldest first so stragglers float up), then opted-out at the bottom
 * (no action needed on them).
 */
function compareAgents(a: DistillStatusAgent, b: DistillStatusAgent): number {
  const rank = (x: DistillStatusAgent): number => {
    if (!x.ossSyncEnabled) return 3;
    if (x.lastOssSyncStatus === 'failed') return 0;
    if (x.lastOssSyncAt === null) return 1;
    return 2;
  };
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra - rb;
  // Within same bucket, oldest first (so the one needing attention is on top).
  const ta = a.lastOssSyncAt ? Date.parse(a.lastOssSyncAt) : 0;
  const tb = b.lastOssSyncAt ? Date.parse(b.lastOssSyncAt) : 0;
  return ta - tb;
}

export function DistillStatusModal({ open, onClose }: Props) {
  // Idle: poll every 60s. While there are queued/running manual jobs the
  // hook auto-bumps to 5s so transitions (waiting → active → ok) appear
  // within a few seconds of happening.
  const { data, isLoading, isFetching, refetch } = useDistillStatus({
    enabled: open,
    refetchIntervalMs: 60_000,
    activeIntervalMs: 5_000,
  });

  // Toggle for the per-bot opt-in. The mutation invalidates the
  // ``distill-status`` query inside its onSuccess so this table refetches
  // on the same tick the row flips — no separate refetch needed here.
  const toggleOssSync = useToggleAgentOssSync();

  // Pin a "now" reference per render so the relative timestamps in one
  // table row don't drift against another row's.
  const now = Date.now();

  const [machineFilter, setMachineFilter] = useState<string>('all');

  /** agentDbId → in-flight job state, for fast lookup in the row render. */
  const inFlightByAgent = useMemo(() => {
    const m = new Map<string, 'waiting' | 'active'>();
    for (const j of data?.inFlight ?? []) {
      // Active beats waiting if the same agent somehow has both (it
      // shouldn't, but the dashboard shouldn't crash on a transient).
      if (j.state === 'active' || !m.has(j.agentDbId)) {
        m.set(j.agentDbId, j.state);
      }
    }
    return m;
  }, [data?.inFlight]);

  const machineOptions = useMemo(() => {
    if (!data) return [] as DistillStatusMachine[];
    return data.machines;
  }, [data]);

  const selectedMachine = useMemo(() => {
    if (!data || machineFilter === 'all') return null;
    return data.machines.find((m) => m.machineId === machineFilter) ?? null;
  }, [data, machineFilter]);

  const filteredAgents = useMemo(() => {
    if (!data) return [] as DistillStatusAgent[];
    const filtered =
      machineFilter === 'all'
        ? data.agents
        : data.agents.filter((a) => a.machineId === machineFilter);
    return [...filtered].sort(compareAgents);
  }, [data, machineFilter]);

  return (
    <Modal open={open} onClose={onClose} title="蒸馏到 OSS — 任务状态" width="max-w-5xl">
      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-claw-muted">
          <Spinner size={20} />
          <span className="ml-2 text-sm">加载中…</span>
        </div>
      ) : !data ? (
        <div className="text-center py-12 text-claw-muted text-sm">无数据</div>
      ) : (
        <div className="space-y-5">
          {/* Top: cron + summary row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-claw-card/60 border border-claw-border rounded-lg p-3">
              <div className="text-[11px] text-claw-muted mb-1">每日定时任务</div>
              <div className="flex items-center gap-2">
                {data.cron.enabled ? (
                  <Badge variant="success">已启用</Badge>
                ) : (
                  <Badge variant="muted">已禁用</Badge>
                )}
                <span className="text-xs text-claw-muted">
                  {data.cron.pattern} · {data.cron.timezone}
                </span>
              </div>
              <div className="mt-1.5 text-[11px] text-claw-muted">
                并发 {data.cron.concurrency} · 单 agent 超时{' '}
                {Math.round(data.cron.perAgentTimeoutMs / 60_000)} 分钟
              </div>
            </div>

            <div className="bg-claw-card/60 border border-claw-border rounded-lg p-3">
              <div className="text-[11px] text-claw-muted mb-1">下次执行</div>
              <div className="text-sm text-claw-text font-medium flex items-center gap-1.5">
                <Clock size={13} className="text-claw-primary-light" />
                {data.cron.nextRunAt ? formatRelative(data.cron.nextRunAt, now) : '未排程'}
              </div>
              {data.cron.nextRunAt && (
                <div className="text-[11px] text-claw-muted mt-1">
                  {new Date(data.cron.nextRunAt).toLocaleString()}
                </div>
              )}
            </div>

            <div className="bg-claw-card/60 border border-claw-border rounded-lg p-3">
              <div className="text-[11px] text-claw-muted mb-1">已成功 / 总数</div>
              <div className="text-sm text-claw-text font-medium">
                <span className="text-claw-success">{data.summary.ok}</span>
                <span className="text-claw-muted"> / {data.summary.total}</span>
                {data.summary.neverSynced > 0 && (
                  <span className="ml-2 text-claw-warning text-xs">
                    {data.summary.neverSynced} 个未蒸馏
                  </span>
                )}
                {data.summary.disabled > 0 && (
                  <span
                    className="ml-2 text-claw-muted text-xs"
                    title="这些 Bot 在 Bot 详情页关闭了「每日蒸馏到 OSS」开关；手动推送不受影响。"
                  >
                    {data.summary.disabled} 个已禁用
                  </span>
                )}
              </div>
              {data.summary.oldestSyncAt && (
                <div className="text-[11px] text-claw-muted mt-1">
                  最旧 {formatRelative(data.summary.oldestSyncAt, now)}
                </div>
              )}
            </div>

            <div className="bg-claw-card/60 border border-claw-border rounded-lg p-3">
              <div className="text-[11px] text-claw-muted mb-1">
                {data.summary.inFlight > 0 ? '正在蒸馏' : '失败'}
              </div>
              <div className="text-sm font-medium">
                {data.summary.inFlight > 0 ? (
                  <span className="text-claw-primary-light flex items-center gap-1.5">
                    <Loader2 size={13} className="animate-spin" />
                    {data.summary.inFlight} 个进行中
                  </span>
                ) : data.summary.failed > 0 ? (
                  <span className="text-claw-danger flex items-center gap-1.5">
                    <AlertCircle size={13} />
                    {data.summary.failed} 个失败
                  </span>
                ) : (
                  <span className="text-claw-success flex items-center gap-1.5">
                    <CheckCircle2 size={13} />
                    全部通过
                  </span>
                )}
              </div>
              {data.summary.inFlight > 0 && data.summary.failed > 0 && (
                <div className="text-[11px] text-claw-danger mt-1">
                  另有 {data.summary.failed} 个失败
                </div>
              )}
            </div>
          </div>

          {/* Recent runs */}
          {data.recentRuns.length > 0 && (
            <div>
              <div className="text-xs text-claw-muted mb-2">最近 N 次定时执行</div>
              <div className="bg-claw-card/40 border border-claw-border rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-claw-card/60 text-claw-muted text-[11px]">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium">触发时间</th>
                      <th className="text-left px-3 py-2 font-medium">完成时间</th>
                      <th className="text-left px-3 py-2 font-medium">耗时</th>
                      <th className="text-left px-3 py-2 font-medium">状态</th>
                      <th className="text-left px-3 py-2 font-medium">备注</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recentRuns.map((run, i) => (
                      <tr
                        key={`${run.id ?? 'run'}-${i}`}
                        className="border-t border-claw-border/60"
                      >
                        <td className="px-3 py-2 text-claw-text whitespace-nowrap">
                          {run.timestamp
                            ? new Date(run.timestamp).toLocaleString()
                            : '—'}
                        </td>
                        <td className="px-3 py-2 text-claw-muted whitespace-nowrap">
                          {run.finishedAt
                            ? new Date(run.finishedAt).toLocaleString()
                            : '—'}
                        </td>
                        <td className="px-3 py-2 text-claw-text">
                          {formatDuration(run.durationMs)}
                        </td>
                        <td className="px-3 py-2">
                          {run.status === 'completed' ? (
                            <Badge variant="success">完成</Badge>
                          ) : (
                            <Badge variant="danger">失败</Badge>
                          )}
                        </td>
                        <td className="px-3 py-2 text-claw-muted truncate max-w-md">
                          {run.failedReason ?? (run.attemptsMade ? `重试 ${run.attemptsMade} 次` : '—')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="text-[11px] text-claw-muted mt-1.5">
                注意：BullMQ 这一行只表示 cron 调度器是否触发到、worker 整体是否抛错；逐 agent 的成败看下面表格。
              </div>
            </div>
          )}

          {/* Per-agent table */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs text-claw-muted">逐 Agent 蒸馏状态</div>
              <div className="flex items-center gap-2">
                <select
                  value={machineFilter}
                  onChange={(e) => setMachineFilter(e.target.value)}
                  className="bg-claw-card border border-claw-border rounded-md px-2 py-1 text-xs text-claw-text"
                >
                  <option value="all">所有机器</option>
                  {machineOptions.map((m) => (
                    <option key={m.machineId} value={m.machineId}>
                      {m.machineAlias}
                    </option>
                  ))}
                </select>
                <Button
                  size="sm"
                  variant="secondary"
                  icon={
                    <RefreshCw
                      size={12}
                      className={isFetching ? 'animate-spin' : ''}
                    />
                  }
                  onClick={() => refetch()}
                  loading={isFetching}
                >
                  刷新
                </Button>
              </div>
            </div>

            {filteredAgents.length === 0 ? (
              <div className="bg-claw-card/40 border border-claw-border rounded-lg p-6 text-center text-claw-muted text-xs">
                {selectedMachine ? (
                  <div className="space-y-1">
                    <div className="text-claw-text">
                      {selectedMachine.machineAlias} 暂无可展示的非 draft agent
                    </div>
                    <div>
                      机器已注册，状态 {selectedMachine.machineStatus}，共登记{' '}
                      {selectedMachine.agentCount} 个 agent；其中{' '}
                      {selectedMachine.distillableAgentCount} 个会出现在 OSS 蒸馏状态表。
                    </div>
                  </div>
                ) : (
                  '没有匹配的 agent'
                )}
              </div>
            ) : (
              <div className="bg-claw-card/40 border border-claw-border rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-claw-card/60 text-claw-muted text-[11px]">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium">机器</th>
                      <th className="text-left px-3 py-2 font-medium">Agent</th>
                      <th
                        className="text-left px-3 py-2 font-medium"
                        title="是否纳入每日 03:00 (Asia/Shanghai) 的 OSS 自动蒸馏；关闭后仅影响定时任务，手动推送不受影响。"
                      >
                        每日同步
                      </th>
                      <th className="text-left px-3 py-2 font-medium">最近蒸馏</th>
                      <th className="text-left px-3 py-2 font-medium">耗时</th>
                      <th className="text-left px-3 py-2 font-medium">状态</th>
                      <th className="text-left px-3 py-2 font-medium">vector_sha</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAgents.map((a) => {
                      const rowMuted = !a.ossSyncEnabled;
                      return (
                        <tr
                          key={a.agentDbId}
                          className={`border-t border-claw-border/60 ${
                            rowMuted ? 'opacity-60' : ''
                          }`}
                        >
                          <td className="px-3 py-2">
                            <span className="inline-flex items-center gap-1 text-claw-text">
                              <Server size={11} className="text-claw-muted" />
                              {a.machineAlias}
                            </span>
                          </td>
                          <td className="px-3 py-2">
                            {a.name ? (
                              <div className="flex flex-col leading-tight">
                                <span className="text-claw-text">{a.name}</span>
                                <span
                                  className="text-[10px] text-claw-muted font-mono"
                                  title={a.agentId}
                                >
                                  {a.agentId}
                                </span>
                              </div>
                            ) : (
                              <span className="text-claw-text font-mono">
                                {a.agentId}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <label
                              className="inline-flex items-center cursor-pointer"
                              title={
                                a.ossSyncEnabled
                                  ? '点击关闭：下次每日定时任务不再同步这个 Bot；手动推送不受影响。'
                                  : '点击开启：下次每日定时任务把这个 Bot 也同步到 OSS。'
                              }
                            >
                              <input
                                type="checkbox"
                                checked={a.ossSyncEnabled}
                                disabled={toggleOssSync.isPending}
                                onChange={(e) =>
                                  toggleOssSync.mutate({
                                    agentId: a.agentDbId,
                                    enabled: e.target.checked,
                                  })
                                }
                                className="sr-only peer"
                                aria-label={`切换 ${a.agentId} 的每日同步`}
                              />
                              <div className="w-8 h-4 bg-claw-border rounded-full peer-checked:bg-claw-primary relative transition-colors">
                                <div
                                  className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full transition-transform ${
                                    a.ossSyncEnabled ? 'translate-x-4' : ''
                                  }`}
                                />
                              </div>
                            </label>
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            {a.lastOssSyncAt ? (
                              <span
                                className="text-claw-text"
                                title={new Date(a.lastOssSyncAt).toLocaleString()}
                              >
                                {formatRelative(a.lastOssSyncAt, now)}
                              </span>
                            ) : a.ossSyncEnabled ? (
                              <span className="text-claw-warning">从未</span>
                            ) : (
                              <span className="text-claw-muted">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-claw-muted">
                            {formatDuration(a.lastOssDurationMs)}
                          </td>
                          <td className="px-3 py-2">
                            {(() => {
                              const flight = inFlightByAgent.get(a.agentDbId);
                              if (flight === 'active') {
                                return (
                                  <span className="inline-flex items-center gap-1 text-claw-primary-light">
                                    <Loader2 size={11} className="animate-spin" />
                                    <Badge variant="info">蒸馏中</Badge>
                                  </span>
                                );
                              }
                              if (flight === 'waiting') {
                                return <Badge variant="info">排队中</Badge>;
                              }
                              // Render the "disabled" badge even on a bot
                              // with a stale success/fail history — when
                              // a user just opted out, the prior status
                              // is no longer actionable and the explicit
                              // "已禁用" tag explains why no new attempts
                              // are happening.
                              if (!a.ossSyncEnabled) {
                                return <Badge variant="muted">已禁用</Badge>;
                              }
                              if (a.lastOssSyncStatus === 'ok') {
                                return <Badge variant="success">成功</Badge>;
                              }
                              if (a.lastOssSyncStatus === 'failed') {
                                return (
                                  <span title={a.lastOssSyncError ?? undefined}>
                                    <Badge variant="danger">失败</Badge>
                                  </span>
                                );
                              }
                              return <Badge variant="muted">未蒸馏</Badge>;
                            })()}
                          </td>
                          <td className="px-3 py-2 text-claw-muted font-mono">
                            {a.lastOssVectorSha ? a.lastOssVectorSha.slice(0, 12) : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {data.summary.failed > 0 && (
              <div className="text-[11px] text-claw-danger mt-1.5">
                提示：把鼠标悬停在「失败」徽章上可以看到具体错误信息（已截断到 500 字节）。
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
