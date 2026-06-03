import { useEffect, useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { Spinner } from '../ui/Spinner';
import {
  Copy, Check, Download, FileText, Brain, Puzzle, Cpu, Database,
  Sparkles, AlertCircle, RefreshCw, Ban, Loader2,
} from 'lucide-react';
import { agentsApi, type DistillBundle } from '../../api/agents.api';
import { getToken } from '../../api/auth.api';

interface DistillBundlePreviewModalProps {
  open: boolean;
  onClose: () => void;
  machineId: string;
  agentId: string;
  agentDisplayName: string;
  /**
   * Optional. When provided, the modal renders a "查看蒸馏状态" button after
   * the job is enqueued so the user can jump directly to the dashboard
   * to watch this agent's row flip from "排队中" → "蒸馏中" → "成功".
   */
  onOpenDashboard?: () => void;
}

/**
 * UI state machine.
 *  - idle: bundle preview is showing, button is enabled.
 *  - enqueuing: POST in flight (a fraction of a second).
 *  - queued: backend returned 202, the job is now on BullMQ.
 *  - error: enqueue failed (validation, queue down, agent missing, etc.).
 *
 * There's no longer a synchronous 'done' state — completion is observed
 * via /api/distill/push-to-oss/status (DistillStatusModal). Trying to
 * fold completion into this modal would require a second polling loop
 * with no benefit since the dashboard already exists.
 */
type DistillStatus = 'idle' | 'enqueuing' | 'queued' | 'error';

/**
 * Response shape from ``POST /api/distill/push-to-oss/single``. The route
 * now enqueues a BullMQ job and returns 202 immediately with the job
 * handle. The previous synchronous fields (vectorSha256 etc.) are no
 * longer returned here — observe them on the agent row via the
 * dashboard or ``GET /api/distill/push-to-oss/status``.
 */
interface OssDistillResponse {
  ok?: boolean;
  error?: string;
  enqueued?: number;
  jobIds?: string[];
  durationMs?: number;
}

/**
 * Persona file blocklist — these are openclaw-runtime scaffolding with
 * no mini-claw analogue. Mirrors ``PERSONA_BLOCKLIST`` in
 * ``backend/src/modules/distill-push/distill-push.service.ts`` so the
 * UI greys out exactly the files we know won't be uploaded.
 */
const PERSONA_BLOCKLIST = new Set<string>(['HEARTBEAT.md', 'BOOTSTRAP.md']);

/**
 * Canonical persona file set — the files we WILL push to OSS. We use
 * this to give greying / "runtime only" badges precedence over the raw
 * `configFileNames` order returned by the snapshot endpoint.
 */
const PERSONA_FILES = new Set<string>([
  'SOUL.md', 'USER.md', 'IDENTITY.md', 'AGENTS.md', 'TOOLS.md',
]);

export function DistillBundlePreviewModal({
  open,
  onClose,
  machineId,
  agentId,
  agentDisplayName,
  onOpenDashboard,
}: DistillBundlePreviewModalProps) {
  const [bundle, setBundle] = useState<DistillBundle | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // One-click distill state (Path B — OSS-direct push).
  const [distillStatus, setDistillStatus] = useState<DistillStatus>('idle');
  const [distillError, setDistillError] = useState<string | null>(null);
  const [distillResult, setDistillResult] = useState<OssDistillResponse | null>(null);

  useEffect(() => {
    if (!open) {
      // Reset transient distill state when modal closes so reopening starts clean.
      setDistillStatus('idle');
      setDistillError(null);
      setDistillResult(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    agentsApi
      .getDistillBundle(machineId, agentId)
      .then((data) => {
        if (!cancelled) setBundle(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : String(err);
          setError(msg);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, machineId, agentId]);

  const handleCopy = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(key);
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      /* ignore clipboard failures */
    }
  };

  /**
   * Trigger Path B — clawconsole's OSS-direct distill push.
   *
   * Flow per bot (see ``DistillPushService.pushAgent``):
   *
   *   1. VACUUM INTO snapshot the openclaw sqlite on the remote
   *   2. Diff + upload raw memory files to OSS `scopes/agent/<key>/raw/`
   *   3. Upload persona (SOUL/USER/IDENTITY/AGENTS/TOOLS) to
   *      OSS `scopes/agent/<key>/persona/` — HEARTBEAT/BOOTSTRAP filtered
   *   4. Upload skill folders to OSS `scopes/agent/<key>/skills/`
   *   5. Upload the vector sqlite + meta to OSS `scopes/agent/<key>/vector/`
   *   6. Webhook to mini-claw with the three manifest shas
   *
   * The UI surfaces all three resulting SHAs so the admin can verify
   * against the platform's "Reconcile from OSS" button on the agent row.
   */
  const handleDistill = async () => {
    setDistillStatus('enqueuing');
    setDistillError(null);
    setDistillResult(null);

    let resp: Response;
    try {
      // We use raw fetch (instead of the shared axios `api` client) so the
      // call mirrors the SSE distill modal and stays light on dependencies.
      // The global axios interceptor that auto-attaches the bearer token is
      // therefore bypassed, so we have to add the Authorization header by
      // hand — without it the new auth.middleware.ts preHandler rejects
      // every /api/* request with 401 Unauthorized.
      const token = getToken();
      resp = await fetch('/api/distill/push-to-oss/single', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ machineId, agentId }),
      });
    } catch (err) {
      setDistillStatus('error');
      setDistillError((err as Error).message);
      return;
    }

    const text = await resp.text();
    let parsed: OssDistillResponse | null = null;
    try {
      parsed = text ? (JSON.parse(text) as OssDistillResponse) : null;
    } catch {
      /* non-JSON */
    }

    // 202 Accepted is the new normal; 200 is also accepted in case the
    // backend is rolling forward / back through the migration. Anything
    // else is an error (validation 400, queue down 503, etc.).
    if (!resp.ok) {
      setDistillStatus('error');
      setDistillError(parsed?.error ?? text ?? `HTTP ${resp.status}`);
      return;
    }

    setDistillResult(parsed);
    setDistillStatus('queued');
  };

  const handleDownloadBundle = () => {
    if (!bundle) return;
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `distill-bundle-${machineId}-${agentId}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const skillCount = bundle?.skills.length ?? 0;
  const memoryCount = bundle?.memory.totalFiles ?? 0;

  const renderField = (label: string, value: string, key: string) => (
    <div className="flex items-center justify-between gap-3 px-3 py-2 bg-claw-input rounded-lg border border-claw-border">
      <div className="min-w-0">
        <div className="text-xs text-claw-muted">{label}</div>
        <div className="text-sm text-claw-text font-mono truncate">{value}</div>
      </div>
      <Button
        variant="secondary"
        size="sm"
        icon={copiedField === key ? <Check size={13} /> : <Copy size={13} />}
        onClick={() => handleCopy(key, value)}
      >
        {copiedField === key ? '已复制' : '复制'}
      </Button>
    </div>
  );

  return (
    <Modal open={open} onClose={onClose} title="推送到 Mini Claw（蒸馏预览）" width="max-w-3xl">
      <div className="space-y-5">
        {/* Intro / how it works */}
        <div className="text-sm text-claw-muted leading-relaxed">
          以下是该 Bot 即将蒸馏到 Mini Claw 平台的完整数据快照。核对无误后，点击下方"一键蒸馏到 Mini Claw"
          即可完成蒸馏；无需切换到 Mini Claw 页面手动操作。
        </div>

        {loading && (
          <div className="flex items-center gap-2 py-6 justify-center text-claw-muted text-sm">
            <Spinner size={16} />
            正在生成蒸馏快照...
          </div>
        )}

        {error && (
          <div className="px-3 py-2 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-400">
            生成快照失败：{error}
          </div>
        )}

        {bundle && !loading && (
          <>
            {/* Snapshot summary — 5 cards: Persona / Raw memory / Vector / Skills / Model */}
            {(() => {
              const personaCount = bundle.workspace.configFileNames.filter(
                (n) => PERSONA_FILES.has(n),
              ).length;
              return (
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                  <div className="bg-claw-card border border-claw-border rounded-xl p-3">
                    <div className="flex items-center gap-2 text-claw-muted text-xs mb-1">
                      <FileText size={13} /> Persona
                    </div>
                    <div className="text-lg font-semibold text-claw-text">{personaCount}</div>
                    <div className="text-[10px] text-claw-muted mt-0.5">→ persona/</div>
                  </div>
                  <div className="bg-claw-card border border-claw-border rounded-xl p-3">
                    <div className="flex items-center gap-2 text-claw-muted text-xs mb-1">
                      <Brain size={13} /> 记忆原文
                    </div>
                    <div className="text-lg font-semibold text-claw-text">{memoryCount}</div>
                    <div className="text-[10px] text-claw-muted mt-0.5">→ raw/</div>
                  </div>
                  <div className="bg-claw-card border border-claw-border rounded-xl p-3">
                    <div className="flex items-center gap-2 text-claw-muted text-xs mb-1">
                      <Database size={13} /> Vector SQLite
                    </div>
                    <div className="text-sm font-semibold text-claw-text">memory.sqlite</div>
                    <div className="text-[10px] text-claw-muted mt-0.5">→ vector/</div>
                  </div>
                  <div className="bg-claw-card border border-claw-border rounded-xl p-3">
                    <div className="flex items-center gap-2 text-claw-muted text-xs mb-1">
                      <Puzzle size={13} /> Skills
                    </div>
                    <div className="text-lg font-semibold text-claw-text">{skillCount}</div>
                    <div className="text-[10px] text-claw-muted mt-0.5">→ skills/</div>
                  </div>
                  <div className="bg-claw-card border border-claw-border rounded-xl p-3">
                    <div className="flex items-center gap-2 text-claw-muted text-xs mb-1">
                      <Cpu size={13} /> Model
                    </div>
                    <div className="text-sm font-semibold text-claw-text truncate">
                      {/* model is `string | { primary, fallbacks? }` —
                          rendering the object form directly would throw
                          "Objects are not valid as a React child". */}
                      {(() => {
                        const m = bundle.agent.modelConfig?.model;
                        if (!m) return '未配置';
                        if (typeof m === 'string') return m;
                        return m.primary;
                      })()}
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* IDs (still surfaced for transparency / manual fallback) */}
            <div>
              <h4 className="text-sm font-semibold text-claw-text mb-2">
                目标 ID
                <span className="text-xs text-claw-muted font-normal ml-2">
                  （蒸馏请求将携带这些 ID，复制按钮用于排障）
                </span>
              </h4>
              <div className="space-y-2">
                {renderField('Machine ID', bundle.machine.id, 'machine_id')}
                {renderField('Agent ID', bundle.agent.id, 'agent_id')}
                {renderField('建议 agent_key', `openclaw-${bundle.agent.agentId}`, 'agent_key')}
              </div>
            </div>

            {/* Persona files preview — separates files that WILL push to OSS
                from openclaw-runtime scaffolding that will be dropped.
                Capped to a scrollable region: in normal repos this is ~5
                files, but a workspace with many random .md files can blow
                up the modal and push the distill button below the fold. */}
            <div>
              <h4 className="text-sm font-semibold text-claw-text mb-2">
                Persona 文件
                <span className="text-xs text-claw-muted font-normal ml-2">
                  （SOUL / USER / IDENTITY / AGENTS / TOOLS → OSS <code>persona/</code>，平台从 OSS 直读）
                </span>
              </h4>
              <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pr-1">
                {bundle.workspace.configFileNames.map((name) => {
                  const isBlocked = PERSONA_BLOCKLIST.has(name);
                  const isPersona = PERSONA_FILES.has(name);
                  if (isBlocked) {
                    return (
                      <span
                        key={name}
                        title="openclaw 运行时专用，不会推送到 Mini Claw"
                        className="inline-block"
                      >
                        <Badge
                          variant="muted"
                          className="opacity-50 line-through decoration-from-font"
                        >
                          <Ban size={10} className="inline mr-0.5 -mt-px" />
                          {name}
                        </Badge>
                      </span>
                    );
                  }
                  if (isPersona) {
                    return (
                      <Badge key={name} variant="info">
                        {name}
                      </Badge>
                    );
                  }
                  // Workspace markdown that's neither in the persona set
                  // nor blocklist — surface as a non-personality file so
                  // the operator can decide whether to rename / drop it.
                  return (
                    <span
                      key={name}
                      title="不在 persona 标准集，蒸馏时会被忽略"
                      className="inline-block"
                    >
                      <Badge variant="muted">{name}</Badge>
                    </span>
                  );
                })}
                {bundle.workspace.configFileNames.length === 0 && (
                  <span className="text-claw-muted text-sm">无</span>
                )}
              </div>
              <div className="mt-2 text-[11px] text-claw-muted flex items-center gap-3">
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block w-2 h-2 rounded-sm bg-claw-primary-light/60" />
                  推送到 persona/
                </span>
                <span className="inline-flex items-center gap-1">
                  <Ban size={10} /> openclaw 运行时（不推送）
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block w-2 h-2 rounded-sm bg-claw-muted/40" />
                  其他 .md（蒸馏时忽略）
                </span>
              </div>
            </div>

            {/* Skills preview.
             *
             * Skill counts in the wild are 100+ for shared agents — rendering
             * every badge unrolled pushes "执行蒸馏" below the viewport and
             * makes the button impossible to click. We collapse by default
             * (just count + "展开 / 收起") and put the expanded list inside
             * a scroll container so the modal height stays predictable. */}
            <SkillsSection skills={bundle.skills} skillCount={skillCount} />

            {/* One-click OSS-direct distill (Path B). The button drives the
                full pipeline: VACUUM INTO → upload raw/persona/skills/vector
                → webhook to mini-claw. The completion panel shows the three
                manifest SHAs so the admin can cross-check against the Agent
                Hub's "Reconcile from OSS" button. */}
            <div>
              <h4 className="text-sm font-semibold text-claw-text mb-2">
                执行蒸馏
                <span className="text-xs text-claw-muted font-normal ml-2">
                  （直接推 OSS · 平台收到 webhook 后从 OSS 读取）
                </span>
              </h4>

              <div className="text-xs text-claw-muted leading-relaxed">
                Mini Claw 不再接收 JSON bundle —— clawconsole 通过 SSH 读取最新内容直接写入
                OSS（<code>scopes/agent/&lt;agent_key&gt;/</code>），并把三个 manifest SHA 通过 webhook
                通知平台。任意一段漂移时，平台会从 OSS 拉取该段刷新缓存。
              </div>

              <div className="mt-3 flex items-center gap-2">
                <Button
                  size="sm"
                  icon={
                    distillStatus === 'enqueuing'
                      ? <RefreshCw size={14} className="animate-spin" />
                      : distillStatus === 'queued'
                        ? <Loader2 size={14} className="animate-spin" />
                        : <Sparkles size={14} />
                  }
                  disabled={distillStatus === 'enqueuing'}
                  onClick={handleDistill}
                >
                  {distillStatus === 'enqueuing'
                    ? '排队中...'
                    : distillStatus === 'queued'
                      ? '再加入一个蒸馏任务'
                      : '一键蒸馏到 Mini Claw'}
                </Button>
                {distillStatus === 'queued' && onOpenDashboard && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={onOpenDashboard}
                  >
                    查看蒸馏状态
                  </Button>
                )}
              </div>

              {distillStatus === 'queued' && (
                <div className="mt-3 px-3 py-2 bg-claw-primary/10 border border-claw-primary/30 rounded-lg text-sm text-claw-text">
                  <div className="flex items-center gap-2 mb-1">
                    <Loader2 size={14} className="text-claw-primary-light animate-spin" />
                    <span className="font-semibold">已加入蒸馏队列</span>
                    {distillResult?.jobIds && distillResult.jobIds.length > 0 && (
                      <Badge variant="info">
                        job #{distillResult.jobIds[distillResult.jobIds.length - 1]}
                      </Badge>
                    )}
                  </div>
                  <div className="text-xs text-claw-muted leading-relaxed">
                    单个 agent 的蒸馏完整流程（重建向量索引、上传 OSS、通知 Mini
                    Claw）通常需要 1–6 分钟，所以我们改成异步执行。
                    {onOpenDashboard ? (
                      <>
                        进度可以在
                        <button
                          type="button"
                          className="text-claw-primary-light hover:underline mx-1"
                          onClick={onOpenDashboard}
                        >
                          蒸馏状态
                        </button>
                        实时查看；该窗口可以关闭。
                      </>
                    ) : (
                      <> 进度可以在「蒸馏状态」面板实时查看；该窗口可以关闭。</>
                    )}
                  </div>
                </div>
              )}

              {distillStatus === 'error' && distillError && (
                <div className="mt-3 px-3 py-2 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-400 flex items-start gap-2">
                  <AlertCircle size={14} className="mt-0.5 shrink-0" />
                  <span className="break-all">蒸馏失败：{distillError}</span>
                </div>
              )}
            </div>

            <div className="flex justify-between items-center pt-2 border-t border-claw-border">
              <div className="text-xs text-claw-muted">
                Bot：<span className="text-claw-text">{agentDisplayName}</span> ·
                生成于 {new Date(bundle.generatedAt).toLocaleString()}
              </div>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Download size={13} />}
                  onClick={handleDownloadBundle}
                >
                  下载快照 JSON
                </Button>
                <Button variant="secondary" size="sm" onClick={onClose}>
                  关闭
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

/**
 * Collapsible skills list. Default collapsed state shows the count + a
 * "展开" button (so the action button below stays in view). Expanding
 * unrolls the full list inside a scroll-bounded container so the modal
 * height never grows past ~10rem of badges, no matter how many skills
 * the bot has installed.
 */
function SkillsSection({
  skills,
  skillCount,
}: {
  skills: DistillBundle['skills'];
  skillCount: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const toggle = () => setExpanded((v) => !v);
  return (
    <div>
      <div className="flex items-center justify-between mb-2 gap-3">
        <h4 className="text-sm font-semibold text-claw-text">
          安装的 Skills{' '}
          <span className="text-claw-muted font-normal">({skillCount})</span>
          <span className="text-xs text-claw-muted font-normal ml-2">
            （会同步写入平台的 Skills Hub）
          </span>
        </h4>
        {skillCount > 0 && (
          <Button
            variant="secondary"
            size="sm"
            className="!py-0.5 !px-2 !text-[11px]"
            onClick={toggle}
          >
            {expanded ? '收起' : '展开'}
          </Button>
        )}
      </div>
      {skillCount === 0 ? (
        <div className="text-claw-muted text-sm">该 Bot 未安装任何 Skill。</div>
      ) : expanded ? (
        <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto pr-1 border border-claw-border rounded-lg p-2 bg-claw-input/30">
          {skills.map((entry) => (
            <Badge key={entry.skill.skillKey} variant="muted">
              {entry.skill.name || entry.skill.skillKey}
              {entry.skill.version ? ` v${entry.skill.version}` : ''}
            </Badge>
          ))}
        </div>
      ) : (
        <div className="text-xs text-claw-muted">
          已折叠以保持窗口高度。点击「展开」查看全部 {skillCount} 个 skill。
        </div>
      )}
    </div>
  );
}

