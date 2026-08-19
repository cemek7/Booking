import type { ReactNode } from 'react';

export type CardProps = {
  children: ReactNode;
  className?: string;
};

/** Surface-toned content card used across conversion sections (FAQ items, process steps, etc.). */
export function Card({ children, className = '' }: CardProps) {
  return (
    <div className={`sc-surface rounded-lg border border-current/10 p-6 ${className}`.trim()}>
      {children}
    </div>
  );
}
