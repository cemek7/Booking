import Link from 'next/link';
import type { ReactNode } from 'react';

type CtaLinkProps = {
  href: string;
  children: ReactNode;
  variant?: 'primary' | 'text';
  tone?: 'green' | 'ink' | 'light';
  className?: string;
};

const focusRing =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--booka-green)]';

const primaryTones = {
  green: 'bg-[var(--booka-green)] text-white hover:bg-[var(--booka-green-strong)]',
  ink: 'bg-[var(--brand-ink)] text-[var(--brand-paper)] hover:bg-[var(--brand-ink-soft)]',
  light: 'bg-[var(--brand-paper)] text-[var(--brand-ink)] hover:bg-white',
};

const textTones = {
  green: 'text-[var(--booka-green-strong)]',
  ink: 'text-[var(--brand-ink)]',
  light: 'text-[var(--brand-paper)]',
};

export default function CtaLink({
  href,
  children,
  variant = 'primary',
  tone = 'green',
  className = '',
}: CtaLinkProps) {
  if (variant === 'text') {
    return (
      <Link
        href={href}
        className={`group inline-flex items-center gap-1.5 rounded-sm text-sm font-semibold underline-offset-4 transition hover:underline ${textTones[tone]} ${focusRing} ${className}`}
      >
        {children}
        <span aria-hidden="true" className="transition group-hover:translate-x-0.5">
          →
        </span>
      </Link>
    );
  }

  return (
    <Link
      href={href}
      className={`inline-flex items-center justify-center rounded-full px-6 py-3 text-sm font-semibold transition duration-200 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] ${primaryTones[tone]} ${focusRing} ${className}`}
    >
      {children}
    </Link>
  );
}
