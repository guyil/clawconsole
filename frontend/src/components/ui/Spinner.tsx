interface SpinnerProps {
  size?: number;
  className?: string;
}

export function Spinner({ size = 24, className = '' }: SpinnerProps) {
  return (
    <div
      className={`border-2 border-claw-border border-t-claw-primary rounded-full animate-spin ${className}`}
      style={{ width: size, height: size }}
    />
  );
}

export function PageSpinner() {
  return (
    <div className="flex items-center justify-center py-20">
      <Spinner size={32} />
    </div>
  );
}
