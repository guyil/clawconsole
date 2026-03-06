interface Props {
  current: number;
  total: number;
  label?: string;
}

export function SyncProgressBar({ current, total, label }: Props) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;

  return (
    <div className="space-y-1">
      {label && (
        <div className="flex justify-between text-xs text-claw-muted">
          <span>{label}</span>
          <span>
            {current}/{total} ({pct}%)
          </span>
        </div>
      )}
      <div className="h-1.5 bg-claw-input rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-claw-primary to-claw-primary-light rounded-full transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
