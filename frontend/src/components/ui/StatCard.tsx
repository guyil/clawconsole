interface StatCardProps {
  label: string;
  value: string | number;
  change?: number;
  color?: string;
}

export function StatCard({ label, value, change }: StatCardProps) {
  return (
    <div className="bg-claw-card rounded-xl border border-claw-border p-5 flex-1 min-w-[160px]">
      <div className="text-claw-muted text-[13px] mb-2">{label}</div>
      <div className="text-[28px] font-bold text-claw-text tracking-tight">{value}</div>
      {change !== undefined && (
        <div
          className={`text-xs mt-1 ${change >= 0 ? 'text-claw-success' : 'text-claw-danger'}`}
        >
          {change >= 0 ? '↑' : '↓'} {Math.abs(change)}% vs 昨日
        </div>
      )}
    </div>
  );
}
