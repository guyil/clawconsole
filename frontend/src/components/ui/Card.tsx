import type { HTMLAttributes, ReactNode } from 'react';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  hover?: boolean;
  selected?: boolean;
  padding?: string;
}

export function Card({
  children,
  hover,
  selected,
  padding = 'p-5',
  className = '',
  ...rest
}: CardProps) {
  const isClickable = hover || rest.onClick;
  return (
    <div
      className={`bg-claw-card rounded-xl border transition-all duration-200
        ${selected ? 'border-claw-primary' : 'border-claw-border'}
        ${hover ? 'hover:bg-claw-card-hover cursor-pointer' : ''}
        ${padding} ${className}`}
      {...(isClickable ? { role: 'button', tabIndex: 0 } : {})}
      {...rest}
    >
      {children}
    </div>
  );
}
