import type { ReactNode } from 'react';

export type HeadingProps = {
  children: ReactNode;
  className?: string;
  level?: 1 | 2 | 3 | 4;
  /** 'display' uses the sc-display (headline) font; 'body' uses the sc-body font. */
  font?: 'display' | 'body';
  /** Optional anchor id, so headings can be linked/scrolled to in-page. */
  id?: string;
};

const LEVEL_CLASSES: Record<NonNullable<HeadingProps['level']>, string> = {
  1: 'text-4xl sm:text-5xl font-semibold tracking-tight',
  2: 'text-3xl sm:text-4xl font-semibold tracking-tight',
  3: 'text-2xl font-semibold',
  4: 'text-xl font-semibold',
};

/** Semantic, theme-aware heading. Renders the real h1-h4 element for the given level. */
export function Heading({ children, className = '', level = 2, font = 'display', id }: HeadingProps) {
  const Tag = (`h${level}` as const);
  const fontClass = font === 'display' ? 'sc-display' : 'sc-body';
  return <Tag id={id} className={`${LEVEL_CLASSES[level]} ${fontClass} ${className}`.trim()}>{children}</Tag>;
}
