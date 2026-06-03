import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { createChildLogger } from '../../shared/logger.js';

const log = createChildLogger('gateway-connector');

export interface GatewayConnectionConfig {
  machineId: string;
  host: string;
  port: number;
  token?: string;
}

interface PendingRequest {
  resolve: (payload: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

type EventHandler = (event: { event: string; payload: unknown }) => void;

/**
 * Manages a WebSocket connection to a single OpenClaw gateway.
 * Handles the connect handshake, RPC calls, and event subscriptions.
 */
class GatewayConnection {
  private ws: WebSocket | null = null;
  private pending = new Map<string, PendingRequest>();
  private connected = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private maxReconnectDelay = 60_000;
  private destroyed = false;
  private eventHandler: EventHandler | null = null;

  constructor(
    private config: GatewayConnectionConfig,
    private onConnected?: () => void,
  ) {}

  get isConnected(): boolean {
    return this.connected;
  }

  setEventHandler(handler: EventHandler): void {
    this.eventHandler = handler;
  }

  connect(): void {
    if (this.destroyed) return;
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) return;

    const url = `ws://${this.config.host}:${this.config.port}`;
    log.info({ machineId: this.config.machineId, url }, 'Connecting to gateway');

    try {
      this.ws = new WebSocket(url, { handshakeTimeout: 10_000 });
    } catch (err) {
      log.error({ machineId: this.config.machineId, err }, 'Failed to create WebSocket');
      this.scheduleReconnect();
      return;
    }

    this.ws.on('open', () => {
      log.info({ machineId: this.config.machineId }, 'WebSocket open');
      this.reconnectAttempt = 0;
    });

    this.ws.on('message', (data) => {
      this.handleMessage(data.toString());
    });

    this.ws.on('close', () => {
      log.info({ machineId: this.config.machineId }, 'WebSocket closed');
      this.connected = false;
      this.rejectAllPending('Connection closed');
      this.scheduleReconnect();
    });

    this.ws.on('error', (err) => {
      log.error({ machineId: this.config.machineId, err: err.message }, 'WebSocket error');
    });
  }

  private handleMessage(raw: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    const type = msg.type as string;

    // Handle connect.challenge -- send connect request
    if (type === 'event' && msg.event === 'connect.challenge') {
      this.sendConnectRequest(msg.payload as Record<string, unknown>);
      return;
    }

    // Handle RPC response
    if (type === 'res') {
      const id = msg.id as string;
      const pending = this.pending.get(id);
      if (pending) {
        this.pending.delete(id);
        clearTimeout(pending.timer);
        if (msg.ok) {
          pending.resolve(msg.payload);
        } else {
          pending.reject(new Error((msg.error as Record<string, unknown>)?.message as string ?? 'RPC error'));
        }
      }
      return;
    }

    // Handle gateway events
    if (type === 'event' && this.eventHandler) {
      this.eventHandler({
        event: msg.event as string,
        payload: msg.payload,
      });
    }
  }

  private sendConnectRequest(_challenge: Record<string, unknown>): void {
    const params: Record<string, unknown> = {
      client: { id: 'clawconsole', version: '1.0' },
      scopes: ['operator.admin'],
    };

    if (this.config.token) {
      params.auth = { token: this.config.token };
    }

    this.sendRaw({
      type: 'req',
      id: randomUUID(),
      method: 'connect',
      params,
    });

    // Mark as connected after sending connect (we'll get a response)
    this.connected = true;
    this.onConnected?.();
  }

  /**
   * Call an RPC method on the gateway and return the result.
   */
  async request<T = unknown>(method: string, params: Record<string, unknown> = {}, timeoutMs = 30_000): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error(`Gateway not connected: ${this.config.machineId}`);
    }

    const id = randomUUID();

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`RPC timeout: ${method} (${timeoutMs}ms)`));
      }, timeoutMs);

      this.pending.set(id, {
        resolve: resolve as (p: unknown) => void,
        reject,
        timer,
      });

      this.sendRaw({ type: 'req', id, method, params });
    });
  }

  private sendRaw(msg: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private scheduleReconnect(): void {
    if (this.destroyed) return;
    if (this.reconnectTimer) return;

    const delay = Math.min(1000 * 2 ** this.reconnectAttempt, this.maxReconnectDelay);
    this.reconnectAttempt++;

    log.info({ machineId: this.config.machineId, delayMs: delay }, 'Scheduling reconnect');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private rejectAllPending(reason: string): void {
    for (const [id, req] of this.pending) {
      clearTimeout(req.timer);
      req.reject(new Error(reason));
      this.pending.delete(id);
    }
  }

  destroy(): void {
    this.destroyed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.rejectAllPending('Connection destroyed');
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
  }
}

/**
 * Pool of gateway connections -- one per registered machine.
 */
export class GatewayConnectorPool {
  private connections = new Map<string, GatewayConnection>();
  private eventHandler: EventHandler | null = null;

  /**
   * Register a global event handler for all gateway events.
   */
  setEventHandler(handler: EventHandler): void {
    this.eventHandler = handler;
    for (const conn of this.connections.values()) {
      conn.setEventHandler(handler);
    }
  }

  /**
   * Add or update a gateway connection for a machine.
   */
  addMachine(config: GatewayConnectionConfig): void {
    const existing = this.connections.get(config.machineId);
    if (existing) {
      existing.destroy();
    }

    const conn = new GatewayConnection(config);
    if (this.eventHandler) {
      conn.setEventHandler(this.eventHandler);
    }
    this.connections.set(config.machineId, conn);
    conn.connect();
  }

  /**
   * Remove a machine's gateway connection.
   */
  removeMachine(machineId: string): void {
    const conn = this.connections.get(machineId);
    if (conn) {
      conn.destroy();
      this.connections.delete(machineId);
    }
  }

  /**
   * Check if a machine's gateway is connected.
   */
  isConnected(machineId: string): boolean {
    return this.connections.get(machineId)?.isConnected ?? false;
  }

  /**
   * Call an RPC method on a specific machine's gateway.
   */
  async request<T = unknown>(machineId: string, method: string, params: Record<string, unknown> = {}): Promise<T> {
    const conn = this.connections.get(machineId);
    if (!conn) {
      throw new Error(`No gateway connection for machine: ${machineId}`);
    }
    return conn.request<T>(method, params);
  }

  /**
   * Call an RPC method on all connected gateways.
   */
  async requestAll<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<Map<string, T>> {
    const results = new Map<string, T>();
    const promises = Array.from(this.connections.entries()).map(async ([machineId, conn]) => {
      if (!conn.isConnected) return;
      try {
        const result = await conn.request<T>(method, params);
        results.set(machineId, result);
      } catch (err) {
        log.warn({ machineId, method, err: (err as Error).message }, 'RPC call failed');
      }
    });
    await Promise.all(promises);
    return results;
  }

  /**
   * Get list of all connected machine IDs.
   */
  getConnectedMachineIds(): string[] {
    return Array.from(this.connections.entries())
      .filter(([, conn]) => conn.isConnected)
      .map(([id]) => id);
  }

  /**
   * Destroy all connections.
   */
  destroy(): void {
    for (const conn of this.connections.values()) {
      conn.destroy();
    }
    this.connections.clear();
  }
}
