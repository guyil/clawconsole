import type { ReactNode } from 'react';

type BadgeVariant = 'success' | 'warning' | 'danger' | 'info' | 'muted';

interface BadgeProps {
  variant?: BadgeVariant;
  children: ReactNode;
  className?: string;
}

const styles: Record<BadgeVariant, string> = {
  success: 'bg-claw-success/15 text-claw-success',
  warning: 'bg-claw-warning/15 text-claw-warning',
  danger: 'bg-claw-danger/15 text-claw-danger',
  info: 'bg-claw-primary/15 text-claw-primary-light',
  muted: 'bg-claw-muted/15 text-claw-muted',
};

export function Badge({ variant = 'muted', children, className = '' }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 text-xs font-medium rounded-full ${styles[variant]} ${className}`}
    >
      {children}
    </span>
  );
}
