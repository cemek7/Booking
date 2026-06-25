'use client';

import React, { useState, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';

export interface DropdownMenuProps {
  children: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const DropdownContext = React.createContext<{
  open: boolean;
  setOpen: (v: boolean) => void;
}>({ open: false, setOpen: () => {} });

export function DropdownMenu({ children, open: controlledOpen, onOpenChange }: DropdownMenuProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen !== undefined ? controlledOpen : internalOpen;
  const setOpen = (v: boolean) => {
    if (onOpenChange) onOpenChange(v);
    else setInternalOpen(v);
  };
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <DropdownContext.Provider value={{ open, setOpen }}>
      <div ref={ref} className="relative inline-block">{children}</div>
    </DropdownContext.Provider>
  );
}

export function DropdownMenuTrigger({ children, asChild }: { children: React.ReactNode; asChild?: boolean }) {
  const { setOpen, open } = React.useContext(DropdownContext);
  if (asChild && React.isValidElement(children)) {
    return React.cloneElement(children as React.ReactElement<{ onClick?: () => void }>, {
      onClick: () => setOpen(!open),
    });
  }
  return <button onClick={() => setOpen(!open)}>{children}</button>;
}

export function DropdownMenuContent({ children, className, align = 'start' }: { children: React.ReactNode; className?: string; align?: 'start' | 'end' }) {
  const { open } = React.useContext(DropdownContext);
  if (!open) return null;
  return (
    <div className={cn(
      'absolute z-50 mt-1 min-w-[8rem] rounded-md border border-gray-200 bg-white shadow-md py-1',
      align === 'end' ? 'right-0' : 'left-0',
      className
    )}>
      {children}
    </div>
  );
}

export function DropdownMenuItem({ children, onClick, className, disabled }: { children: React.ReactNode; onClick?: () => void; className?: string; disabled?: boolean }) {
  const { setOpen } = React.useContext(DropdownContext);
  return (
    <button
      disabled={disabled}
      className={cn('w-full text-left px-3 py-1.5 text-sm hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed', className)}
      onClick={() => { onClick?.(); setOpen(false); }}
    >
      {children}
    </button>
  );
}

export function DropdownMenuSeparator({ className }: { className?: string }) {
  return <div className={cn('my-1 border-t border-gray-200', className)} />;
}

export function DropdownMenuLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('px-3 py-1 text-xs font-semibold text-gray-500 uppercase tracking-wide', className)}>{children}</div>;
}
