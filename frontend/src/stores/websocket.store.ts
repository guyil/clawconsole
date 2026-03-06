import { create } from 'zustand';
import toast from 'react-hot-toast';

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

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

    ws.onopen = () => set({ connected: true, socket: ws });

    ws.onmessage = (e) => {
      try {
        const event: WSEvent = JSON.parse(e.data);
        get().addEvent(event);
        handleSyncEvent(event, get);
      } catch {
        /* ignore non-JSON messages */
      }
    };

    ws.onclose = () => {
      set({ connected: false, socket: null });
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
