'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';

type NavItem = { href: string; label: string };

type MobileNavProps = {
  links: NavItem[];
  cta?: NavItem;
  ctaTone?: 'green' | 'ink';
};

const focusRing =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--booka-green)]';

/** Phone-only menu for the landing pages. Desktop keeps the inline nav. */
export default function MobileNav({ links, cta, ctaTone = 'green' }: MobileNavProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const onPointer = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  const close = () => setOpen(false);
  const ctaClass =
    ctaTone === 'ink'
      ? 'bg-[var(--brand-ink)] text-[var(--brand-paper)]'
      : 'bg-[var(--booka-green)] text-white';

  return (
    <div ref={rootRef} className="relative md:hidden">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className={`inline-flex min-h-11 items-center gap-2 rounded-full border border-[var(--brand-line)] bg-[#fdfcf8] px-4 text-sm font-semibold text-[var(--brand-ink)] transition active:scale-[0.98] ${focusRing}`}
      >
        <span aria-hidden="true" className="flex w-4 flex-col gap-[3px]">
          <span className={`h-[2px] rounded bg-current transition ${open ? 'translate-y-[5px] rotate-45' : ''}`} />
          <span className={`h-[2px] rounded bg-current transition ${open ? 'opacity-0' : ''}`} />
          <span className={`h-[2px] rounded bg-current transition ${open ? '-translate-y-[5px] -rotate-45' : ''}`} />
        </span>
        {open ? 'Close' : 'Menu'}
      </button>

      {open ? (
        <div
          id={panelId}
          className="absolute right-0 top-[calc(100%+0.5rem)] z-40 w-64 rounded-[1.25rem] border border-[var(--brand-line)] bg-[#fdfcf8] p-2 shadow-[0_24px_60px_rgba(16,33,26,0.16)]"
        >
          <ul>
            {links.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  onClick={close}
                  className={`flex min-h-11 items-center rounded-xl px-4 text-[15px] text-[var(--brand-ink)] transition hover:bg-[var(--brand-paper)] ${focusRing}`}
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
          {cta ? (
            <Link
              href={cta.href}
              onClick={close}
              className={`mt-2 flex min-h-11 items-center justify-center rounded-full px-4 text-sm font-semibold transition active:scale-[0.98] ${ctaClass} ${focusRing}`}
            >
              {cta.label}
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
