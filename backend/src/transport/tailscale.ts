import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createChildLogger } from '../shared/logger.js';

const log = createChildLogger('tailscale');

const TAILSCALE_MACOS_PATH = '/Applications/Tailscale.app/Contents/MacOS/Tailscale';

function resolveTailscaleBin(): string {
  if (process.platform === 'darwin' && existsSync(TAILSCALE_MACOS_PATH)) {
    return TAILSCALE_MACOS_PATH;
  }
  return 'tailscale';
}

interface TailscaleNode {
  hostname: string;
  tailscaleIp: string;
  online: boolean;
  os: string;
  lastSeen: string;
}

interface TailscaleStatus {
  self: TailscaleNode;
  peers: TailscaleNode[];
}

export class TailscaleClient {
  async getStatus(): Promise<TailscaleStatus> {
    const raw = await this.execTailscale(['status', '--json']);
    const json = JSON.parse(raw);

    const self: TailscaleNode = {
      hostname: json.Self?.HostName ?? '',
      tailscaleIp: json.Self?.TailscaleIPs?.[0] ?? '',
      online: json.Self?.Online ?? false,
      os: json.Self?.OS ?? '',
      lastSeen: json.Self?.LastSeen ?? '',
    };

    const peers: TailscaleNode[] = Object.values(json.Peer ?? {}).map((peer: any) => ({
      hostname: peer.HostName ?? '',
      tailscaleIp: peer.TailscaleIPs?.[0] ?? '',
      online: peer.Online ?? false,
      os: peer.OS ?? '',
      lastSeen: peer.LastSeen ?? '',
    }));

    return { self, peers };
  }

  async ping(hostname: string): Promise<{ reachable: boolean; latencyMs: number | null }> {
    try {
      const raw = await this.execTailscale(['ping', '--c', '1', '--timeout', '5s', hostname], {
        allowNonZero: true,
      });
      // "pong from X in Nms" appears even when exit code is 1 (relay-only, no direct connection)
      const pongMatch = raw.match(/pong from .+ in (\d+(?:\.\d+)?)ms/);
      if (pongMatch) {
        return { reachable: true, latencyMs: parseFloat(pongMatch[1]) };
      }
      return { reachable: false, latencyMs: null };
    } catch {
      return { reachable: false, latencyMs: null };
    }
  }

  async isNodeOnline(hostname: string): Promise<boolean> {
    try {
      const status = await this.getStatus();
      const peer = status.peers.find(
        (p) => p.hostname === hostname || `${p.hostname}.tailnet` === hostname,
      );
      return peer?.online ?? false;
    } catch (err) {
      log.warn({ hostname, err }, 'Failed to check Tailscale node status');
      return false;
    }
  }

  /**
   * Resolve a tailnet hostname to its 100.x.y.z IP. Returns null if the
   * peer isn't in the tailnet or the CLI is unavailable. Used by
   * ``MachineService.healthCheck`` to backfill the ``machines.tailscale_ip``
   * column so the UI can show "100.100.x.x" instead of an empty cell.
   */
  async resolveIp(hostname: string): Promise<string | null> {
    try {
      const status = await this.getStatus();
      if (status.self.hostname === hostname && status.self.tailscaleIp) {
        return status.self.tailscaleIp;
      }
      const peer = status.peers.find(
        (p) => p.hostname === hostname || `${p.hostname}.tailnet` === hostname,
      );
      return peer?.tailscaleIp || null;
    } catch (err) {
      log.warn({ hostname, err: (err as Error).message }, 'resolveIp failed');
      return null;
    }
  }

  private execTailscale(
    args: string[],
    opts?: { allowNonZero?: boolean },
  ): Promise<string> {
    const bin = resolveTailscaleBin();
    return new Promise((resolve, reject) => {
      execFile(bin, args, { timeout: 15_000 }, (err, stdout, stderr) => {
        if (err && !opts?.allowNonZero) {
          log.error({ args, err, stderr }, 'Tailscale command failed');
          reject(new Error(`tailscale ${args.join(' ')} failed: ${stderr || err.message}`));
          return;
        }
        resolve(stdout + (stderr ?? ''));
      });
    });
  }
}
