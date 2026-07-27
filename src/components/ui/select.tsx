'use client';

import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

type SelectContextValue = {
  value?: string;
  onValueChange?: (value: string) => void;
  open: boolean;
  setOpen: (open: boolean) => void;
  labels: Record<string, string>;
  registerLabel: (value: string, label: string) => void;
};

const SelectContext = createContext<SelectContextValue | null>(null);

export interface SelectProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  name?: string;
  disabled?: boolean;
}

export function Select({ className, value, defaultValue, onValueChange, name, disabled, children, ...props }: SelectProps) {
  const [internalValue, setInternalValue] = useState(defaultValue ?? '');
  const [open, setOpen] = useState(false);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const selectedValue = value ?? internalValue;

  useEffect(() => {
    function onClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const context = useMemo<SelectContextValue>(() => ({
    value: selectedValue,
    onValueChange: (next) => {
      if (value === undefined) setInternalValue(next);
      onValueChange?.(next);
    },
    open,
    setOpen,
    labels,
    registerLabel: (nextValue, label) => {
      setLabels((prev) => (prev[nextValue] === label ? prev : { ...prev, [nextValue]: label }));
    },
  }), [labels, open, onValueChange, selectedValue, value]);

  return (
    <SelectContext.Provider value={context}>
      {/* z-50 while open so the dropdown paints above sibling cards' stacking contexts */}
      <div ref={wrapperRef} className={cn('relative inline-block w-full', open && 'z-50', className)} {...props}>
        {name ? <input type="hidden" name={name} value={selectedValue} readOnly /> : null}
        {disabled ? <input type="hidden" disabled value={selectedValue} readOnly /> : null}
        {children}
      </div>
    </SelectContext.Provider>
  );
}

export interface SelectTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children?: React.ReactNode;
}

export function SelectTrigger({ className, children, type = 'button', onClick, disabled, ...props }: SelectTriggerProps) {
  const ctx = useContext(SelectContext);
  if (!ctx) throw new Error('SelectTrigger must be used within Select');

  return (
    <button
      type={type}
      className={cn(
        'flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background',
        'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      aria-haspopup="listbox"
      aria-expanded={ctx.open}
      disabled={disabled}
      onClick={(e) => {
        onClick?.(e);
        if (!e.defaultPrevented && !disabled) ctx.setOpen(!ctx.open);
      }}
      {...props}
    >
      <span className="flex min-w-0 flex-1 items-center gap-2">{children}</span>
      <ChevronDown className="h-4 w-4 opacity-60 shrink-0" />
    </button>
  );
}

export interface SelectValueProps {
  placeholder?: string;
}

export function SelectValue({ placeholder }: SelectValueProps) {
  const ctx = useContext(SelectContext);
  const label = ctx?.value;
  const display = label && ctx?.labels[label] ? ctx.labels[label] : label;
  return <span className={cn('truncate', !display ? 'text-muted-foreground' : '')}>{display || placeholder || 'Select…'}</span>;
}

export interface SelectContentProps {
  children?: React.ReactNode;
  className?: string;
}

export function SelectContent({ children, className }: SelectContentProps) {
  const ctx = useContext(SelectContext);
  if (!ctx) throw new Error('SelectContent must be used within Select');
  if (!ctx.open) return null;

  return (
    <div
      role="listbox"
      className={cn(
        // Solid background: the `popover` color token is not defined in
        // tailwind.config, so bg-popover resolved to transparent.
        'absolute z-50 mt-2 w-full min-w-[8rem] overflow-hidden rounded-md border border-slate-200 bg-white text-slate-900 shadow-lg',
        className
      )}
    >
      <div className="max-h-64 overflow-auto p-1">{children}</div>
    </div>
  );
}

export interface SelectItemProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  value: string;
  children?: React.ReactNode;
}

export function SelectItem({ className, children, value, type = 'button', disabled, onClick, ...props }: SelectItemProps) {
  const ctx = useContext(SelectContext);
  if (!ctx) throw new Error('SelectItem must be used within Select');
  const selected = ctx.value === value;
  const label = React.Children.toArray(children)
    .map((node) => (typeof node === 'string' ? node : typeof node === 'number' ? String(node) : ''))
    .join('')
    .trim() || value;

  useEffect(() => {
    ctx.registerLabel(value, label);
  }, [ctx, label, value]);

  return (
    <button
      type={type}
      role="option"
      aria-selected={selected}
      disabled={disabled}
      className={cn(
        'flex w-full cursor-pointer items-center rounded-sm px-2 py-1.5 text-sm outline-none text-left',
        'hover:bg-accent hover:text-accent-foreground',
        selected ? 'bg-accent text-accent-foreground' : '',
        disabled ? 'pointer-events-none opacity-50' : '',
        className
      )}
      onClick={(e) => {
        onClick?.(e);
        if (!e.defaultPrevented && !disabled) {
          ctx.onValueChange?.(value);
          ctx.setOpen(false);
        }
      }}
      {...props}
    >
      {children}
    </button>
  );
}
