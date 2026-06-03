import { useEffect, useRef, useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { Sparkles, RefreshCw, AlertCircle, CheckCircle2, SkipForward, XCircle } from 'lucide-react';
import { getToken } from '../../api/auth.api';

type DistillStatus = 'idle' | 'running' | 'done' | 'error';

interface AgentRow {
  agent_id: string;
  machine_name: string;
  status: 'pending' | 'running' | 'done' | 'error' | 'skipped';
  detail?: string;
  agent_key?: string;
  system_prompt_chars?: number;
  memory_files?: number;
  skills_upserted?: number;
  duration_ms?: number;
}

interface CompleteSummary {
  ok: number;
  failed: number;
  skipped: number;
  total: number;
  duration_ms: number;
  fatal_error?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * One-click "distill all OpenClaw agents → Mini Claw" modal.
 *
 * Posts to clawconsole's /api/distill/to-miniclaw which reverse-proxies an
 * SSE stream from Mini Claw. Each agent is a row; we update its status as
 * agent:start / agent:done / agent:skipped / agent:error events arrive.
 */
export function DistillToMiniclawModal({ open, onClose }: Props) {
  const [status, setStatus] = useState<DistillStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<AgentRow[]>([]);
  const [summary, setSummary] = useState<CompleteSummary | null>(null);
  const [meta, setMeta] = useState<Record<string, unknown> | null>(null);
  const [refreshRemote, setRefreshRemote] = useState(false);
  const [onlyChanged, setOnlyChanged] = useState(false);
  const [includeDrafts, setIncludeDrafts] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open) {
      // tear down on close
      abortRef.current?.abort();
      abortRef.current = null;
      setStatus('idle');
      setError(null);
      setRows([]);
      setSummary(null);
      setMeta(null);
    }
  }, [open]);

  const reset = () => {
    setStatus('idle');
    setError(null);
    setRows([]);
    setSummary(null);
    setMeta(null);
  };

  const start = async () => {
    reset();
    setStatus('running');
    const controller = new AbortController();
    abortRef.current = controller;

    let resp: Response;
    try {
      // Raw fetch (not the axios `api` client) so we can stream the SSE
      // response below — axios doesn't expose a streaming body. Because we
      // bypass the shared request interceptor, we have to attach the
      // bearer token ourselves; otherwise auth.middleware.ts rejects with
      // 401 Unauthorized.
      const token = getToken();
      resp = await fetch('/api/distill/to-miniclaw', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          refreshRemote,
          onlyChanged,
          includeDrafts,
          maxConcurrent: 3,
          dryRun: false,
        }),
        signal: controller.signal,
      });
    } catch (e) {
      setStatus('error');
      setError((e as Error).message);
      return;
    }

    if (!resp.ok || !resp.body) {
      const text = await resp.text().catch(() => '');
      setStatus('error');
      try {
        const obj = JSON.parse(text);
        setError(obj.error ?? text);
      } catch {
        setError(text || `HTTP ${resp.status}`);
      }
      return;
    }

    // ----- SSE stream parser -----
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        // SSE events are separated by blank lines
        let nl: number;
        while ((nl = buf.indexOf('\n\n')) !== -1) {
          const chunk = buf.slice(0, nl);
          buf = buf.slice(nl + 2);
          const ev = parseSseChunk(chunk);
          if (ev) handleEvent(ev.event, ev.data);
        }
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        setStatus('error');
        setError((e as Error).message);
      }
      return;
    }
    // If we got here without seeing a 'complete' event, treat as done anyway.
    setStatus((s) => (s === 'running' ? 'done' : s));
  };

  const handleEvent = (event: string, data: Record<string, unknown>) => {
    if (event === 'start') {
      setMeta(data);
      const total = Number(data.total ?? 0);
      // Pre-populate placeholder rows so the UI doesn't pop in/out
      setRows(
        Array.from({ length: total }, (_, i) => ({
          agent_id: `…agent ${i + 1}`,
          machine_name: '…',
          status: 'pending' as const,
        })),
      );
    } else if (event === 'agent:start') {
      const idx = Number(data.idx ?? 0) - 1;
      if (idx < 0) return;
      setRows((prev) => {
        const next = [...prev];
        next[idx] = {
          agent_id: String(data.agent_id ?? '?'),
          machine_name: String(data.machine_name ?? '?'),
          status: 'running',
        };
        return next;
      });
    } else if (event === 'agent:done') {
      const idx = Number(data.idx ?? 0) - 1;
      if (idx < 0) return;
      setRows((prev) => {
        const next = [...prev];
        next[idx] = {
          ...next[idx],
          agent_id: String(data.agent_id ?? next[idx]?.agent_id ?? '?'),
          machine_name: String(data.machine_name ?? next[idx]?.machine_name ?? '?'),
          status: 'done',
          agent_key: data.agent_key as string | undefined,
          system_prompt_chars: data.system_prompt_chars as number | undefined,
          memory_files: data.memory_files as number | undefined,
          skills_upserted: data.skills_upserted as number | undefined,
          duration_ms: data.duration_ms as number | undefined,
        };
        return next;
      });
    } else if (event === 'agent:skipped') {
      const idx = Number(data.idx ?? 0) - 1;
      if (idx < 0) return;
      setRows((prev) => {
        const next = [...prev];
        next[idx] = {
          ...next[idx],
          agent_id: String(data.agent_id ?? next[idx]?.agent_id ?? '?'),
          machine_name: String(data.machine_name ?? next[idx]?.machine_name ?? '?'),
          status: 'skipped',
          detail: data.reason as string | undefined,
        };
        return next;
      });
    } else if (event === 'agent:error') {
      const idx = Number(data.idx ?? 0) - 1;
      if (idx < 0) return;
      setRows((prev) => {
        const next = [...prev];
        next[idx] = {
          ...next[idx],
          agent_id: String(data.agent_id ?? next[idx]?.agent_id ?? '?'),
          machine_name: String(data.machine_name ?? next[idx]?.machine_name ?? '?'),
          status: 'error',
          detail: data.error as string | undefined,
        };
        return next;
      });
    } else if (event === 'complete') {
      setSummary(data as unknown as CompleteSummary);
      setStatus('done');
      if (data.fatal_error) {
        setStatus('error');
        setError(String(data.fatal_error));
      }
    }
  };

  const cancel = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStatus('idle');
  };

  return (
    <Modal open={open} onClose={onClose} title="蒸馏全部 → Mini Claw" width="max-w-3xl">
      {status === 'idle' && (
        <div className="space-y-4">
          <p className="text-sm text-claw-muted">
            将这台 clawconsole 上所有 OpenClaw agent 的人格 / 记忆 / Skills 蒸馏到 Mini Claw 的 Agents Hub。
            每个 agent 同时把它工作目录里 <code className="text-claw-text">discoveredSkills</code> 列表里的 skills 全量同步到 Mini Claw 的 Skills 表。
          </p>
          <div className="space-y-2 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={onlyChanged} onChange={(e) => setOnlyChanged(e.target.checked)} />
              <span className="text-claw-text">仅蒸馏内容有变化的 agent</span>
              <span className="text-xs text-claw-muted">（基于 lastSyncedAt vs hub.updated_at）</span>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={refreshRemote} onChange={(e) => setRefreshRemote(e.target.checked)} />
              <span className="text-claw-text">蒸馏前先 SSH 刷新远程缓存</span>
              <span className="text-xs text-claw-muted">（更慢但保证最新）</span>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={includeDrafts} onChange={(e) => setIncludeDrafts(e.target.checked)} />
              <span className="text-claw-text">包含 status=draft 的 agent</span>
            </label>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" size="sm" onClick={onClose}>取消</Button>
            <Button size="sm" icon={<Sparkles size={14} />} onClick={start}>开始蒸馏</Button>
          </div>
        </div>
      )}

      {status !== 'idle' && (
        <div className="space-y-4 max-h-[60vh] overflow-y-auto">
          {meta && (
            <div className="text-xs text-claw-muted flex items-center gap-3">
              <Badge variant="info">total {String(meta.total ?? 0)}</Badge>
              {Boolean(meta.only_changed) && <Badge variant="muted">only-changed</Badge>}
              {Boolean(meta.refresh_remote) && <Badge variant="muted">refresh-remote</Badge>}
              <span className="ml-auto opacity-70">auth: {String(meta.auth_via ?? '?')}</span>
            </div>
          )}

          <div className="space-y-1.5">
            {rows.map((r, i) => (
              <RowItem key={i} row={r} />
            ))}
          </div>

          {summary && (
            <div className="border-t border-claw-border pt-3 mt-2 text-sm flex items-center gap-3">
              <CheckCircle2 size={16} className="text-green-400" />
              <span className="text-claw-text">
                完成 {summary.ok}{summary.failed > 0 && <> · 失败 {summary.failed}</>}{summary.skipped > 0 && <> · 跳过 {summary.skipped}</>} / 共 {summary.total}
              </span>
              <span className="ml-auto text-xs text-claw-muted">
                {(summary.duration_ms / 1000).toFixed(1)}s
              </span>
            </div>
          )}

          {error && (
            <div className="text-sm text-red-400 flex items-start gap-2">
              <AlertCircle size={14} className="mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            {status === 'running' ? (
              <Button variant="secondary" size="sm" onClick={cancel}>取消</Button>
            ) : (
              <>
                <Button variant="secondary" size="sm" icon={<RefreshCw size={14} />} onClick={start}>再跑一次</Button>
                <Button size="sm" onClick={onClose}>关闭</Button>
              </>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

function RowItem({ row }: { row: AgentRow }) {
  const icon =
    row.status === 'done' ? <CheckCircle2 size={14} className="text-green-400" /> :
    row.status === 'error' ? <XCircle size={14} className="text-red-400" /> :
    row.status === 'skipped' ? <SkipForward size={14} className="text-claw-muted" /> :
    row.status === 'running' ? <RefreshCw size={14} className="text-claw-primary-light animate-spin" /> :
    <span className="w-3.5 h-3.5 inline-block" />;

  return (
    <div className="flex items-center gap-2 text-xs px-2 py-1.5 rounded-md bg-claw-card/30 border border-claw-border/50">
      {icon}
      <span className="font-mono text-claw-text truncate" style={{ maxWidth: 180 }}>{row.agent_id}</span>
      <span className="text-claw-muted">@ {row.machine_name}</span>
      {row.status === 'done' && (
        <span className="ml-auto flex items-center gap-2 text-claw-muted">
          {typeof row.skills_upserted === 'number' && row.skills_upserted > 0 && (
            <Badge variant="info">{row.skills_upserted} skills</Badge>
          )}
          {typeof row.memory_files === 'number' && (
            <span>{row.memory_files} mem</span>
          )}
          {typeof row.duration_ms === 'number' && (
            <span>{(row.duration_ms / 1000).toFixed(1)}s</span>
          )}
        </span>
      )}
      {row.status === 'skipped' && row.detail && (
        <span className="ml-auto text-claw-muted truncate" style={{ maxWidth: 280 }}>{row.detail}</span>
      )}
      {row.status === 'error' && row.detail && (
        <span className="ml-auto text-red-400 truncate" style={{ maxWidth: 280 }}>{row.detail}</span>
      )}
    </div>
  );
}

// ------ helpers ------
function parseSseChunk(chunk: string): { event: string; data: Record<string, unknown> } | null {
  let event = 'message';
  const dataLines: string[] = [];
  for (const line of chunk.split('\n')) {
    if (line.startsWith('event:')) {
      event = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trim());
    }
    // ignore comment / id / keepalive lines
  }
  if (dataLines.length === 0) return null;
  try {
    return { event, data: JSON.parse(dataLines.join('\n')) };
  } catch {
    return null;
  }
}
