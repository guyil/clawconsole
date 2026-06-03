import { create } from 'zustand';
import toast from 'react-hot-toast';
import { clearToken, getToken } from '../api/auth.api';

export interface WSEvent {
  type: string;
  timestamp: string;
  payload: Record<string, unknown>;
}

export interface SyncProgress {
  operationId: string;
  current: number;
  total: number;
  file: string;
  status: string;
}

interface WebSocketState {
  connected: boolean;
  events: WSEvent[];
  socket: WebSocket | null;
  activeSyncs: Map<string, SyncProgress>;

  connect: () => void;
  disconnect: () => void;
  addEvent: (event: WSEvent) => void;
  clearEvents: () => void;
}

const MAX_EVENTS = 100;

function handleSyncEvent(event: WSEvent, get: () => WebSocketState) {
  const p = event.payload;
  switch (event.type) {
    case 'sync:started':
      toast(`同步开始: ${p.direction ?? 'sync'}`, { icon: '🔄' });
      break;
    case 'sync:progress': {
      const opId = p.operationId as string;
      const progress: SyncProgress = {
        operationId: opId,
        current: p.current as number,
        total: p.total as number,
        file: p.file as string,
        status: p.status as string,
      };
      const syncs = new Map(get().activeSyncs);
      syncs.set(opId, progress);
      break;
    }
    case 'sync:completed': {
      const status = p.status as string;
      if (status === 'completed') {
        toast.success(`同步完成: ${p.syncedFiles} 文件, ${((p.durationMs as number) / 1000).toFixed(1)}s`);
      } else {
        toast.error(`同步异常: ${p.failedFiles} 文件失败`);
      }
      break;
    }
    case 'sync:conflict':
      toast(`发现 ${(p.conflicts as unknown[])?.length ?? 0} 个冲突`, { icon: '⚠️' });
      break;
    case 'machine:status':
      toast(`节点状态变更: ${p.status}`, { icon: '🖥️' });
      break;
  }
}

export const useWebSocketStore = create<WebSocketState>((set, get) => ({
  connected: false,
  events: [],
  socket: null,
  activeSyncs: new Map(),

  connect: () => {
    const existing = get().socket;
    if (existing && existing.readyState <= WebSocket.OPEN) return;

    // Bail if there's no token — there's no point opening a socket that
    // the server is going to slam shut with code 4401, and the resulting
    // 3s reconnect loop would just spam the log. App boot only mounts
    // the AuthedApp (which calls connect) after a successful auth, so a
    // missing token here usually means the token just got cleared by a
    // 401 response interceptor; the page reload is imminent.
    const token = getToken();
    if (!token) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(url);

    ws.onopen = () => set({ connected: true, socket: ws });

    ws.onmessage = (e) => {
      try {
        const event: WSEvent = JSON.parse(e.data);
        // Server sends this just before closing the socket with 4401
        // when the token is invalid / expired. Treat it identically to
        // an HTTP 401: drop the cached token and bounce the page to
        // the login screen.
        if (event.type === 'auth_error') {
          clearToken();
          window.location.reload();
          return;
        }
        get().addEvent(event);
        handleSyncEvent(event, get);
      } catch {
        /* ignore non-JSON messages */
      }
    };

    ws.onclose = (e) => {
      set({ connected: false, socket: null });
      // 4401 = our custom "unauthorized" close code from ws-server.ts.
      // Don't reconnect — the user needs to log in again.
      if (e.code === 4401) {
        clearToken();
        window.location.reload();
        return;
      }
      setTimeout(() => get().connect(), 3000);
    };

    ws.onerror = () => ws.close();
  },

  disconnect: () => {
    const ws = get().socket;
    if (ws) ws.close();
    set({ connected: false, socket: null });
  },

  addEvent: (event) =>
    set((s) => ({
      events: [event, ...s.events].slice(0, MAX_EVENTS),
    })),

  clearEvents: () => set({ events: [] }),
}));
