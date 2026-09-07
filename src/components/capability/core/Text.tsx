import type { ReactNode } from 'react';

export type TextProps = {
  children: ReactNode;
  className?: string;
  /** Visual weight/role; 'muted' is for secondary/help copy (still meets contrast). */
  tone?: 'default' | 'muted';
  size?: 'sm' | 'base' | 'lg';
  as?: 'p' | 'span';
};

const SIZE_CLASSES: Record<NonNullable<TextProps['size']>, string> = {
  sm: 'text-sm',
  base: 'text-base',
  lg: 'text-lg',
};

/** Body copy primitive. Uses the sc-body font and respects the sc-* scoped theme. */
export function Text({ children, className = '', tone = 'default', size = 'base', as = 'p' }: TextProps) {
  const Tag = as;
  const toneClass = tone === 'muted' ? 'opacity-70' : '';
  return <Tag className={`sc-body ${SIZE_CLASSES[size]} ${toneClass} ${className}`.trim()}>{children}</Tag>;
}
