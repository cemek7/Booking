import type { HTMLAttributes, ReactNode } from 'react';

type PanelProps = HTMLAttributes<HTMLElement> & {
  tone?: 'paper' | 'dark' | 'green';
  as?: 'div' | 'section' | 'article';
  children: ReactNode;
};

const tones = {
  paper: 'border border-[var(--brand-line)] bg-[#fdfcf8]',
  dark: 'bg-[var(--brand-ink)] text-[var(--brand-paper)] shadow-[0_24px_70px_rgba(16,33,26,0.18)]',
  green: 'bg-[var(--booka-green)] text-white shadow-[0_24px_70px_rgba(4,120,87,0.2)]',
};

/** The only boxed surface on the landing pages. Use sparingly: the spec caps how many a page may have. */
export default function Panel({
  tone = 'paper',
  as: Tag = 'div',
  className = '',
  children,
  ...rest
}: PanelProps) {
  return (
    <Tag data-surface={tone} className={`rounded-[1.75rem] ${tones[tone]} ${className}`} {...rest}>
      {children}
    </Tag>
  );
}
