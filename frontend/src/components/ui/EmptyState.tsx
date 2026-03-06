import type { ReactNode } from 'react';

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      {icon && <div className="text-claw-muted mb-4">{icon}</div>}
      <h3 className="text-lg font-semibold text-claw-text mb-1">{title}</h3>
      {description && <p className="text-sm text-claw-muted mb-4 max-w-sm">{description}</p>}
      {action}
    </div>
  );
}
