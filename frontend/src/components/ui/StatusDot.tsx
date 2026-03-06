type Status = 'online' | 'running' | 'connected' | 'offline' | 'paused' | 'error' | 'expired' | 'unknown';

interface StatusDotProps {
  status: Status | string;
  size?: number;
  pulse?: boolean;
}

const colorMap: Record<string, string> = {
  online: 'bg-claw-success shadow-[0_0_8px_rgba(0,214,143,0.25)]',
  running: 'bg-claw-success shadow-[0_0_8px_rgba(0,214,143,0.25)]',
  connected: 'bg-claw-success shadow-[0_0_8px_rgba(0,214,143,0.25)]',
  paused: 'bg-claw-warning',
  warning: 'bg-claw-warning',
  error: 'bg-claw-danger',
  expired: 'bg-claw-danger',
  failed: 'bg-claw-danger',
  offline: 'bg-claw-muted',
  unknown: 'bg-claw-muted',
};

export function StatusDot({ status, size = 8, pulse = true }: StatusDotProps) {
  const isActive = ['online', 'running', 'connected'].includes(status);
  return (
    <span
      className={`inline-block rounded-full ${colorMap[status] ?? 'bg-claw-muted'}`}
      style={{
        width: size,
        height: size,
        animation: isActive && pulse ? 'pulse-dot 2s infinite' : 'none',
      }}
    />
  );
}
