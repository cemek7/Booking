import type { ReactNode } from 'react';

export type SectionProps = {
  children: ReactNode;
  className?: string;
  id?: string;
  /** 'surface' picks up the --sc-surface scoped background; 'bg' uses --sc-background. */
  tone?: 'bg' | 'surface' | 'none';
  as?: 'section' | 'div';
};

/** Full-width vertical rhythm wrapper for page sections. Composes sc-* tone classes with Tailwind spacing. */
export function Section({ children, className = '', id, tone = 'none', as = 'section' }: SectionProps) {
  const Tag = as;
  const toneClass = tone === 'bg' ? 'sc-bg' : tone === 'surface' ? 'sc-surface' : '';
  return (
    <Tag id={id} className={`py-16 sm:py-24 ${toneClass} ${className}`.trim()}>
      {children}
    </Tag>
  );
}
